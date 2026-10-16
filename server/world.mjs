import { Debugger, Host, ProcessRunner, Runtime, SmallObject } from '../src/index.js';
import { SqliteConnection } from './sqlite.mjs';
import { encode, parameters } from './values.js';
import { Inspectors } from '../src/inspector.js';

export const sources = {
  Database: [
    `schema ^service call: 'schema'`,
    `close ^service call: 'close'`,
    `execute: sql ^self execute: sql parameters: (service call: 'emptyParameters')`,
    `execute: sql parameters: bindings
      | data result |
      data := service call: 'execute' with: sql with: bindings.
      result := ResultSet new.
      ^result initialize: data`,
  ],
  ResultSet: [
    `initialize: data
      columns := data get: 'columns'. rows := data get: 'rows'.
      rowsAffected := data get: 'rowsAffected'.
      rowCount := (rows get: 'length') truncated. position := 0. closed := false`,
    `columns ^columns`, `rowCount ^rowCount`, `rowsAffected ^rowsAffected`,
    `atEnd ^position >= rowCount`,
    `next: count
      | end page |
      closed ifTrue: [^self fail: 'The result is closed.'].
      self checkCount: count.
      end := position + count.
      end > rowCount ifTrue: [end := rowCount].
      page := rows call: 'slice' with: position asFloat with: end asFloat.
      position := end. ^page`,
    `pageFrom: offset count: count
      closed ifTrue: [^self fail: 'The result is closed.'].
      self checkOffset: offset.
      position := offset. ^self next: count`,
    `close rows := nil. closed := true`,
  ],
};

export class ServerWorld {
  constructor(path) {
    this.runtime = new Runtime();
    this.debugger = new Debugger(this.runtime);
    this.waiting = new Map();
    this.inFlight = new Set();
    this.results = new Map();
    this.resultIds = new WeakMap();
    this.nextResult = 1;
    this.runner = new ProcessRunner(this.runtime, { onChange: id => this.changed(id) });
    this.host = new Host(this.runtime, this.runner);
    this.inspectors = new Inspectors(this.host, this.debugger);
    this.scope = this.host.scope();
    const slots = { Database: ['service'], ResultSet: ['columns', 'rows', 'position', 'rowCount', 'rowsAffected', 'closed'] };
    for (const [name, names] of Object.entries(slots)) this.runtime.defineClass(name, { category: 'Server-Data', slots: names });
    for (const [name, methods] of Object.entries(sources)) {
      const klass = this.runtime.classes.get(name);
      for (const source of methods) this.runtime.installSource(klass, source, { protocol: name === 'ResultSet' ? 'results' : 'operations' });
    }
    const resultClass = this.runtime.classes.get('ResultSet');
    this.runtime.primitive(resultClass, 'fail:', 1, (_receiver, [message]) => { throw new Error(message); });
    this.runtime.primitive(resultClass, 'checkCount:', 1, (_receiver, [count]) => {
      if (typeof count !== 'bigint' || count < 1n || count > 1000n) throw new Error('Page size must be an Integer from 1 through 1000.');
      return count;
    });
    this.connection = new SqliteConnection(path);
    this.runtime.primitive(resultClass, 'checkOffset:', 1, (receiver, [offset]) => {
      if (typeof offset !== 'bigint' || offset < 0n || offset > receiver.slots.rowCount) throw new Error('Page offset must be an Integer within the result.');
      return offset;
    });
    this.database = this.runtime.newObject(this.runtime.classes.get('Database'));
    this.database.slots.service = this.host.value({
      execute: (sql, bindings) => this.connection.execute(sql, parameters(bindings)),
      schema: () => this.connection.schema(), emptyParameters: () => [],
      close: async () => { await this.connection.close(); return null; },
    });
  }

  changed(id) {
    const process = this.runtime.processes.get(id);
    if (!process || process.status === 'waiting' || (process.status === 'paused' && ['budget', 'ready'].includes(process.stop.reason))) return;
    const resolve = this.waiting.get(id);
    if (resolve) { this.waiting.delete(id); resolve(process); }
  }

  async send(receiver, selector, args = [], { pause = false, signal } = {}) {
    if (signal?.aborted) throw signal.reason;
    const id = this.runtime.start(receiver, selector, args, { scope: this.scope });
    this.inFlight.add(id);
    const ready = new Promise(resolve => this.waiting.set(id, resolve));
    const abort = () => {
      const process = this.runtime.processes.get(id);
      if (process && ['paused', 'waiting'].includes(process.status)) {
        this.runtime.cancel(id);
        this.runner.follow(id);
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (!pause) this.runtime.run(id, { budget: 1000 });
    this.runner.follow(id);
    try {
      await ready;
      return this.completion(id);
    } finally {
      signal?.removeEventListener('abort', abort);
      this.inFlight.delete(id);
      for (const previous of this.scope.processes) {
        if (previous !== id && !this.inFlight.has(previous) && ['completed', 'cancelled'].includes(this.runtime.process(previous).status)) {
          this.runner.forget(previous);
          this.runtime.dispose(previous);
        }
      }
    }
  }

  describe(result) {
    let id = this.resultIds.get(result);
    if (!id) { id = `r${this.nextResult++}`; this.resultIds.set(result, id); }
    if (result.slots.closed) this.results.delete(id); else this.results.set(id, result);
    const { columns, rowCount, rowsAffected, position, closed } = result.slots;
    return encode({ id, columns: this.host.unwrap(columns), rowCount, rowsAffected, position, closed });
  }

  completion(id) {
    const process = this.runtime.process(id);
    if (process.status !== 'completed') return { process: { runtime: 'server', ...this.debugger.inspect(id) } };
    const value = process.result;
    return {
      process: { runtime: 'server', id, status: process.status },
      ...(value instanceof SmallObject && value.klass.name === 'ResultSet' ? { result: this.describe(value) } : { value: encode(this.host.unwrap(value)) }),
    };
  }

  result(id) {
    const result = this.results.get(id);
    if (!result || result.slots.closed) throw new Error(`Unknown or closed result: ${id}.`);
    return result;
  }

  state() {
    return {
      runtime: 'server',
      inspectors: [...this.inspectors.sessions.keys()],
      database: this.debugger.value(this.database),
      results: [...this.results.values()].map(result => ({ ...this.describe(result), object: this.debugger.value(result) })),
      processes: this.debugger.dispatch({ op: 'processes' }),
      breakpoints: [...this.runtime.breakpoints.keys()],
      stopOnSignal: this.runtime.stopOnSignal,
    };
  }

  async dispatch(request, { signal } = {}) {
    const options = { pause: request.pause, signal };
    switch (request.op) {
      case 'state': return this.state();
      case 'inspector': return this.inspectors.dispatch(request);
      case 'schema': return this.send(this.database, 'schema', [], options);
      case 'execute': return this.send(this.database, 'execute:parameters:', [request.sql, this.host.value(parameters(request.parameters))], options);
      case 'next':
      case 'page': {
        const result = this.result(request.id);
        const count = BigInt(request.count ?? 100);
        const response = await this.send(result, request.op === 'next' ? 'next:' : 'pageFrom:count:', request.op === 'next' ? [count] : [BigInt(request.offset ?? 0), count], options);
        return { ...response, result: this.describe(result) };
      }
      case 'close': {
        const result = this.result(request.id);
        const response = await this.send(result, 'close', [], options);
        if (result.slots.closed) this.results.delete(request.id);
        return response;
      }
      case 'completion': return this.completion(request.processId);
      case 'send': {
        const object = request.target === 'database' ? this.database : this.result(request.target);
        return this.send(object, request.selector, (request.args ?? []).map(value => this.debugger.decode(value)), options);
      }
      case 'debug': {
        const result = this.debugger.dispatch(request.request);
        const { op, processId } = request.request;
        if (op === 'dispose') this.runner.forget(processId);
        if (['run', 'resume', 'pause', 'step', 'stepOver', 'stepOut', 'retry', 'cancel'].includes(op)) this.runner.follow(processId);
        return result;
      }
      default: throw new Error(`Unknown server command: ${request.op}.`);
    }
  }

  async close() {
    this.inspectors.dispose();
    for (const result of this.results.values()) { result.slots.rows = null; result.slots.closed = true; }
    this.results.clear();
    for (const id of this.waiting.keys()) {
      const process = this.runtime.process(id);
      if (['paused', 'waiting'].includes(process.status)) this.runtime.cancel(id);
      this.changed(id);
    }
    this.scope.dispose();
    this.runner.close();
    this.debugger.releaseAll();
    await this.connection.close();
  }
}

export function completed(response) {
  if (response.process?.status !== 'completed') {
    const error = new Error(`Server process ${response.process?.id} ${response.process?.stop?.error?.message ?? response.process?.stop?.reason ?? response.process?.status}.`);
    error.process = response.process;
    throw error;
  }
  return response;
}
