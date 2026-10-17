import { Debugger, Host, ProcessRunner, Runtime, SmallObject } from '../src/index.js';
import { SqliteConnection } from './sqlite.mjs';
import { encode, parameters } from './values.js';
import { Inspectors } from '../src/inspector.js';
import { SourceStore, loadSources, requireLoaded } from '../src/sources.js';
import { SourceFiles } from './source-files.mjs';

export class ServerWorld {
  constructor(path, { sources, report }) {
    if (!(sources instanceof SourceFiles)) throw new Error('A server world requires its SourceFiles.');
    if (typeof report !== 'function') throw new Error('A server world requires a report function for source file errors.');
    const packages = Object.fromEntries(['kernel', 'tools', 'server'].map(name => [name, sources.readSync(name)]));
    this.runtime = new Runtime({ sources: packages.kernel });
    requireLoaded(loadSources(this.runtime, [...packages.tools, ...packages.server]), 'server');
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
    this.sources = new SourceStore({ runtime: this.runtime, packages, report, label: 'server runtime' });
    this.sources.attach((packageName, fileName, text, version) => sources.write(packageName, fileName, text, version));
    this.subscription = sources.subscribe(this.sources.versions(), update => this.sources.receive(update))
      .catch(error => { report(error); return () => {}; });
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
    await this.sources.settled();
    (await this.subscription)();
    this.sources.dispose();
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
