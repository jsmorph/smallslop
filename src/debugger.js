import { Code, Op, decode } from './bytecode.js';
import { Block, SmallClass, SmallObject } from './runtime.js';
import { HostValue } from './host-value.js';

export class Debugger {
  constructor(runtime) {
    this.runtime = runtime;
    this.objects = new Map();
    this.ids = new WeakMap();
    this.retainedMethods = new Map();
    this.nextId = 1;
  }

  value(value) {
    const klass = this.runtime.classOf(value);
    if (value === null) return { kind: 'nil' };
    if (typeof value === 'bigint') return { kind: 'integer', value: String(value) };
    if (typeof value === 'number') {
      return { kind: 'float', value: Object.is(value, -0) ? '-0' : Number.isFinite(value) ? value : String(value) };
    }
    if (typeof value === 'boolean' || typeof value === 'string') return { kind: typeof value, value };
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(value, id);
      this.objects.set(id, value);
    }
    return { kind: 'object', id, className: klass.name };
  }

  decode(value) {
    if (!value || typeof value !== 'object') throw new Error('Expected an encoded debugger value.');
    switch (value.kind) {
      case 'nil': return null;
      case 'object': return this.#object(value.id);
      case 'integer':
        if (typeof value.value === 'string' && /^-?\d+$/.test(value.value)) return BigInt(value.value);
        break;
      case 'float':
        if (typeof value.value === 'number' && Number.isFinite(value.value)) return value.value;
        if (['-0', 'NaN', 'Infinity', '-Infinity'].includes(value.value)) return Number(value.value);
        break;
      case 'boolean':
      case 'string': if (typeof value.value === value.kind) return value.value;
    }
    throw new Error('Invalid debugger value.');
  }

  #object(id) {
    if (!this.objects.has(id)) throw new Error(`Unknown object handle: ${id}.`);
    return this.objects.get(id);
  }

  release(ids) {
    for (const id of ids) this.#object(id);
    for (const id of ids) {
      this.ids.delete(this.objects.get(id));
      this.objects.delete(id);
    }
  }

  retainMethod(id) {
    const method = this.runtime.methods.get(id);
    if (!method) throw new Error(`Unknown method: ${id}.`);
    this.retainedMethods.set(id, method);
    return { retained: id };
  }

  releaseMethods(ids) {
    for (const id of ids) if (!this.retainedMethods.has(id)) throw new Error(`Method ${id} is not retained.`);
    for (const id of ids) this.retainedMethods.delete(id);
    return { released: ids };
  }

  releaseAll() {
    this.objects.clear();
    this.ids = new WeakMap();
    this.retainedMethods.clear();
    return { released: 'all' };
  }

  #bindings(bindings) {
    return Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name, this.value(value)]));
  }

  object(id, { offset = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Object inspection requires a nonnegative offset and a limit in 1..1000.');
    }
    const value = this.#object(id);
    const result = { ...this.value(value) };
    if (value instanceof SmallObject) result.slots = this.#bindings(value.slots);
    else if (value instanceof SmallClass) {
      Object.assign(result, {
        name: value.name, category: value.category, superclass: this.value(value.superclass), slots: value.slots,
        methods: [...value.methods.values()].map(method => ({ id: method.id, selector: method.selector, arity: method.arity })),
      });
    } else if (value instanceof Block) {
      const scopes = [];
      for (let scope = value.environment; scope; scope = scope.parent) {
        scopes.push(this.#bindings(Object.fromEntries(scope.names.map((name, i) => [name, scope.values[i]]))));
      }
      Object.assign(result, {
        methodId: value.method.id, codePath: [...value.codePath], args: value.code.args, receiver: this.value(value.receiver),
        home: { ...value.home }, scopes,
      });
    } else if (value instanceof HostValue) {
      result.hostType = typeof value.value;
      const host = value.value;
      if (host !== null && ['object', 'function'].includes(typeof host)) {
        const array = Array.isArray(host) || (ArrayBuffer.isView(host) && !(host instanceof DataView));
        const names = array ? null : Object.getOwnPropertyNames(host);
        const total = array ? host.length : names.length;
        const properties = [];
        for (let index = offset; index < Math.min(total, offset + limit); index++) {
          const name = array ? String(index) : names[index];
          const descriptor = Object.getOwnPropertyDescriptor(host, name);
          if (!descriptor) properties.push({ name, absent: true });
          else if ('value' in descriptor) {
            const item = descriptor.value;
            properties.push(typeof item === 'symbol' ? { name, unsupported: 'symbol' }
              : { name, value: this.value(this.runtime.host.value(item)) });
          } else properties.push({ name, accessor: true, get: !!descriptor.get, set: !!descriptor.set });
        }
        Object.assign(result, { indexed: array, total, offset, properties });
      }
    } else if (Array.isArray(value)) {
      Object.assign(result, { length: value.length, offset, items: value.slice(offset, offset + limit).map(item => this.value(item)) });
    }
    return result;
  }

  describe(value, options = {}) {
    const encoded = this.value(value);
    return encoded.kind === 'object' ? this.object(encoded.id, options)
      : { ...encoded, className: this.runtime.classOf(value).name };
  }

  inspect(processId) {
    const state = this.runtime.inspect(processId);
    this.runtime.process(processId).debuggerRetained = true;
    let stop = state.stop;
    if (stop?.reason === 'error') {
      const error = stop.error;
      const detail = { name: error?.name ?? 'ThrownValue', message: error?.message ?? String(error) };
      if (error?.name === 'MessageNotUnderstood') {
        Object.assign(detail, {
          receiver: this.value(error.receiver), selector: error.selector,
          arguments: error.arguments.map(value => this.value(value)),
        });
      }
      stop = { reason: 'error', error: detail };
    }
    return {
      ...state, stop, result: this.value(state.result),
      frames: state.frames.map(frame => ({
        ...frame, receiver: this.value(frame.receiver),
        scopes: frame.scopes.map(scope => this.#bindings(scope)),
        stack: frame.stack.map(value => this.value(value)),
        pendingSend: frame.pendingSend ? {
          ...frame.pendingSend, receiver: this.value(frame.pendingSend.receiver),
          arguments: frame.pendingSend.arguments.map(value => this.value(value)),
        } : null,
      })),
    };
  }

  method(id) {
    const method = this.runtime.methods.get(id);
    if (!method) throw new Error(`Unknown method: ${id}.`);
    const codes = [];
    const visit = (code, path) => {
      codes.push({
        path, args: code.args, locals: code.locals, source: code.source, positions: code.positions, bytes: code.bytes,
        literals: code.literals.map((value, index) => value instanceof Code
          ? { kind: 'code', path: [...path, index] } : this.value(value)),
      });
      code.literals.forEach((value, index) => { if (value instanceof Code) visit(value, [...path, index]); });
    };
    if (method.code) visit(method.code, []);
    return { id, className: method.owner.name, selector: method.selector, protocol: method.protocol,
      format: method.format, arity: method.arity, primitive: !method.code, codes };
  }

  classes() {
    return [...this.runtime.classes.values()].map(klass => ({ name: klass.name, category: klass.category,
      superclass: klass.superclass?.name ?? null, slots: [...klass.slots], methodCount: klass.methods.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  methods({ className, selector, sends } = {}) {
    if (className !== undefined && !this.runtime.classes.has(className)) throw new Error(`Unknown class: ${className}.`);
    const calls = code => code && (code.boundaries.some(pc => {
      const instruction = decode(code.bytes, pc);
      return [Op.send, Op.superSend].includes(instruction.op) && code.literals[instruction.args[0]] === sends;
    }) || code.literals.some(literal => literal instanceof Code && calls(literal)));
    return [...this.runtime.classes.values()].filter(klass => className === undefined || klass.name === className)
      .flatMap(klass => [...klass.methods.values()])
      .filter(method => (selector === undefined || method.selector === selector) && (sends === undefined || calls(method.code)))
      .map(method => ({ id: method.id, className: method.owner.name, selector: method.selector, protocol: method.protocol,
        format: method.format, source: method.code?.source ?? null }))
      .sort((a, b) => a.className.localeCompare(b.className) || a.selector.localeCompare(b.selector));
  }

  dispatch(request) {
    const { op, processId } = request;
    switch (op) {
      case 'classes': return this.classes();
      case 'methods': return this.methods(request);
      case 'processes':
        return [...this.runtime.processes.values()].map(process => ({ id: process.id, status: process.status }));
      case 'inspect': return this.inspect(processId);
      case 'object': return this.object(request.id, request);
      case 'method': return this.method(request.id);
      case 'release': this.release(request.ids); return { released: request.ids };
      case 'releaseAll': return this.releaseAll();
      case 'retainMethod': return this.retainMethod(request.id);
      case 'releaseMethods': return this.releaseMethods(request.ids);
      case 'dispose': return this.runtime.dispose(processId);
      case 'evaluate': {
        const id = this.runtime.evaluate(request.source, {
          processId, frameId: request.frameId,
          receiver: request.receiver ? this.decode(request.receiver) : null,
        });
        return this.inspect(id);
      }
      case 'install': {
        const klass = this.runtime.classes.get(request.className);
        if (!klass) throw new Error(`Unknown class: ${request.className}.`);
        const method = this.runtime.installSource(klass, request.source, request);
        return this.method(method.id);
      }
      case 'breakpoint': {
        const method = this.runtime.methods.get(request.methodId);
        if (!method?.code) throw new Error('Breakpoint requires a bytecode method.');
        let code = method.code;
        for (const index of request.path ?? []) {
          code = code.literals[index];
          if (!(code instanceof Code)) throw new Error('Invalid block code path.');
        }
        return { id: this.runtime.breakpoint(method, request.pc ?? 0, code) };
      }
      case 'clearBreakpoint': this.runtime.clearBreakpoint(request.id); return { cleared: request.id };
      case 'setVariable':
        this.runtime.setVariable(processId, request.frameId, request.name, this.decode(request.value), { depth: request.depth });
        break;
      case 'setSendOperand':
        this.runtime.setSendOperand(processId, request.frameId, request.index, this.decode(request.value));
        break;
      case 'run':
      case 'resume':
      case 'pause':
      case 'step':
      case 'stepOver':
      case 'stepOut':
      case 'retry':
      case 'cancel': this.runtime[op](processId, { budget: request.budget }); break;
      default: throw new Error(`Unknown debugger operation: ${op}.`);
    }
    return this.inspect(processId);
  }
}
