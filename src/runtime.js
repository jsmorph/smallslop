import { Code, Op, assemble, decode } from './bytecode.js';
import { compileExpression, compileMethod } from './compiler.js';
import { installKernel } from './kernel.js';
import { WeakRegistry } from './weak-registry.js';
import { HostOperation, HostValue } from './host-value.js';
import { BlockCall, SendCall, SmallCharacter, SmallClass, SmallObject, SmallSymbol } from './objects.js';

export { SmallCharacter, SmallClass, SmallObject, SmallSymbol };

class Environment {
  constructor(names, values, parent = null) {
    this.names = names;
    this.values = names.map((_, i) => i < values.length ? values[i] : null);
    this.parent = parent;
  }

  scope(depth) {
    if (!Number.isSafeInteger(depth) || depth < 0) throw new Error('Invalid lexical scope.');
    let environment = this;
    for (let i = 0; i < depth; i++) environment = environment?.parent;
    if (!environment) throw new Error('Invalid lexical scope.');
    return environment;
  }

  at(depth, index) {
    const environment = this.scope(depth);
    if (!Number.isSafeInteger(index) || index < 0 || index >= environment.values.length) throw new Error('Invalid lexical binding.');
    return environment;
  }

  find(name) {
    for (let environment = this; environment; environment = environment.parent) {
      const index = environment.names.indexOf(name);
      if (index >= 0) return { environment, index };
    }
    throw new Error(`Unknown variable: ${name}.`);
  }
}

export class Block {
  constructor(frame, code, index = frame.code.literals.indexOf(code)) {
    this.code = code;
    this.codePath = Object.freeze([...frame.codePath, index]);
    this.environment = frame.environment;
    this.receiver = frame.receiver;
    this.home = frame.home;
    this.method = frame.method;
  }
}

export class Runtime {
  constructor() {
    this.classes = new Map();
    this.methods = new WeakRegistry();
    this.processes = new Map();
    this.breakpoints = new Map();
    this.nextId = 1;
    this.identityHashes = new WeakMap();
    this.nextIdentityHash = 1;
    this.objectClass = this.defineClass('Object', { superclass: null, category: 'Kernel-Objects' });
    this.objectClass.metaclass.superclass = this.defineClass('Class', { category: 'Kernel-Classes' });
    this.defineClass('Metaclass', { superclass: this.classes.get('Class'), category: 'Kernel-Classes' });
    for (const [name, superclass, category] of [
      ['Magnitude', 'Object', 'Kernel-Magnitudes'], ['Number', 'Magnitude', 'Kernel-Numbers'],
      ['Collection', 'Object', 'Collections-Abstract'], ['SequenceableCollection', 'Collection', 'Collections-Abstract'],
      ['ArrayedCollection', 'SequenceableCollection', 'Collections-Abstract'],
      ['UndefinedObject', 'Object', 'Kernel-Objects'], ['Boolean', 'Object', 'Kernel-Objects'],
      ['True', 'Boolean', 'Kernel-Objects'], ['False', 'Boolean', 'Kernel-Objects'],
      ['Integer', 'Number', 'Kernel-Numbers'], ['Float', 'Number', 'Kernel-Numbers'],
      ['Character', 'Magnitude', 'Kernel-Magnitudes'], ['String', 'ArrayedCollection', 'Collections-Text'],
      ['Symbol', 'String', 'Collections-Text'], ['Array', 'ArrayedCollection', 'Collections-Sequenceable'],
      ['Block', 'Object', 'Kernel-Objects'], ['HostObject', 'Object', 'Kernel-Host'],
    ]) this.defineClass(name, { superclass: this.classes.get(superclass), category });
    this.nativeClasses = new Set(['Class', 'Metaclass', 'UndefinedObject', 'Boolean', 'True', 'False', 'Integer', 'Float',
      'Character', 'String', 'Symbol', 'Array', 'Block', 'HostObject'].map(name => this.classes.get(name)));
    this.primitive(this.objectClass, 'yourself', 0, receiver => receiver);
    this.primitive(this.objectClass, 'class', 0, receiver => this.classOf(receiver));
    this.primitive(this.objectClass, '==', 1, (receiver, [other]) => receiver === other);
    this.primitive(this.classes.get('Class'), 'new', 0, receiver => this.newObject(receiver), { protocol: 'instance creation' });
    this.primitive(this.classes.get('Class'), 'basicNew', 0, receiver => this.newObject(receiver), { protocol: 'instance creation' });
    for (let count = 0; count <= 4; count++) {
      const selector = count ? 'value:'.repeat(count) : 'value';
      this.primitive(this.classes.get('Block'), selector, count, (receiver, args) => new BlockCall(receiver, args));
    }
    installKernel(this);
  }

  defineClass(name, { superclass = this.objectClass, slots = [], classSlots = [], category = 'Unclassified' } = {}) {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || this.classes.has(name)) throw new Error(`Invalid or existing class: ${name}.`);
    if (superclass !== null && (superclass?.runtime !== this || superclass.meta)) throw new Error('Superclass must be a class in this runtime.');
    if ([...slots, ...classSlots].some(slot => typeof slot !== 'string' || !slot)) throw new Error('Slots need names.');
    if (typeof category !== 'string' || !category.trim()) throw new Error('A class category needs a name.');
    const klass = new SmallClass(this, name, superclass, slots, category);
    klass.metaclass = new SmallClass(this, `${name} class`, superclass?.metaclass ?? this.classes.get('Class') ?? null, classSlots, category, klass);
    klass.slotValues = Object.fromEntries(klass.metaclass.slots.map(slot => [slot, null]));
    this.classes.set(name, klass);
    return klass;
  }

  redefineClass(klass, { superclass = klass.superclass, slots, classSlots, category = klass.category }) {
    if (!(klass instanceof SmallClass) || klass.runtime !== this || klass.meta || this.nativeClasses.has(klass) || klass === this.objectClass) {
      throw new Error(`${klass?.name} cannot be redefined.`);
    }
    if (!(superclass instanceof SmallClass) || superclass.runtime !== this || superclass.meta) throw new Error('Superclass must be a class in this runtime.');
    for (let current = superclass; current; current = current.superclass) if (current === klass) throw new Error(`${klass.name} cannot inherit from itself.`);
    if (typeof category !== 'string' || !category.trim()) throw new Error('A class category needs a name.');
    const own = behavior => behavior.slots.slice(behavior.superclass?.slots.length ?? 0);
    const affected = [];
    const collect = current => {
      affected.push({ klass: current, slots: own(current), classSlots: own(current.metaclass) });
      for (const child of this.classes.values()) if (child.superclass === current) collect(child);
    };
    collect(klass);
    affected[0].slots = slots ?? affected[0].slots;
    affected[0].classSlots = classSlots ?? affected[0].classSlots;
    if ([...affected[0].slots, ...affected[0].classSlots].some(slot => typeof slot !== 'string' || !slot)) throw new Error('Slots need names.');
    const before = affected.map(({ klass: current }) => [current.superclass, current.slots, current.metaclass.slots]);
    const layoutChanged = superclass !== klass.superclass
      || affected[0].slots.join(' ') !== own(klass).join(' ') || affected[0].classSlots.join(' ') !== own(klass.metaclass).join(' ');
    klass.superclass = superclass;
    klass.metaclass.superclass = superclass.metaclass;
    try {
      for (const entry of affected) {
        const current = entry.klass;
        for (const [behavior, names] of [[current, entry.slots], [current.metaclass, entry.classSlots]]) {
          const layout = [...behavior.superclass.slots, ...names];
          if (new Set(layout).size !== layout.length) throw new Error(`Duplicate slot in ${behavior.name}.`);
          behavior.slots = Object.freeze(layout);
        }
        for (const name of current.metaclass.slots) if (!Object.hasOwn(current.slotValues, name)) current.slotValues[name] = null;
      }
    } catch (error) {
      affected.forEach(({ klass: current }, index) => {
        [current.superclass, current.slots, current.metaclass.slots] = before[index];
        current.metaclass.superclass = current.superclass.metaclass;
      });
      throw error;
    }
    klass.category = klass.metaclass.category = category;
    const failures = [];
    if (!layoutChanged) return failures;
    for (const { klass: current } of affected) {
      for (const behavior of [current, current.metaclass]) {
        for (const method of [...behavior.methods.values()]) {
          if (method.format !== 'source') continue;
          try { this.installSource(behavior, method.code.source, { protocol: method.protocol }); }
          catch (error) { failures.push({ className: behavior.name, selector: method.selector, message: error.message }); }
        }
      }
    }
    return failures;
  }

  classNamed(name) {
    const meta = typeof name === 'string' && name.endsWith(' class');
    const klass = this.classes.get(meta ? name.slice(0, -' class'.length) : name);
    return meta ? klass?.metaclass : klass;
  }

  behaviors() {
    return [...this.classes.values()].flatMap(klass => [klass, klass.metaclass]);
  }

  newObject(klass) {
    if (!(klass instanceof SmallClass) || klass.runtime !== this) throw new Error('Expected a class in this runtime.');
    if (klass.meta) throw new Error(`${klass.name} has one instance, ${klass.instanceClass.name}.`);
    for (let current = klass; current; current = current.superclass) {
      if (this.nativeClasses.has(current)) throw new Error(`${klass.name} requires a native value constructor.`);
    }
    return new SmallObject(klass);
  }

  identityHash(value) {
    if (value === null || ['boolean', 'bigint', 'number', 'string'].includes(typeof value)) {
      const text = `${typeof value}:${Object.is(value, -0) ? 0 : value}`;
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
      return BigInt(hash);
    }
    this.classOf(value);
    let hash = this.identityHashes.get(value);
    if (hash === undefined) this.identityHashes.set(value, hash = BigInt(this.nextIdentityHash++));
    return hash;
  }

  classOf(value) {
    if (value instanceof HostValue) {
      if (value.runtime !== this) throw new Error('Host value belongs to another runtime.');
      return this.classes.get('HostObject');
    }
    if (value instanceof SmallObject) {
      if (value.klass.runtime !== this) throw new Error('Object belongs to another runtime.');
      return value.klass;
    }
    if (value instanceof SmallClass) {
      if (value.runtime !== this) throw new Error('Class belongs to another runtime.');
      return value.meta ? this.classes.get('Metaclass') : value.metaclass;
    }
    if (value instanceof SmallSymbol) return this.classes.get('Symbol');
    if (value instanceof SmallCharacter) return this.classes.get('Character');
    if (value instanceof Block) {
      if (value.method.owner.runtime !== this) throw new Error('Block belongs to another runtime.');
      return this.classes.get('Block');
    }
    const name = value === null ? 'UndefinedObject' : Array.isArray(value) ? 'Array'
      : typeof value === 'boolean' ? (value ? 'True' : 'False')
      : ({ bigint: 'Integer', number: 'Float', string: 'String' })[typeof value];
    if (!name) throw new Error('Value has no Smallslop class.');
    return this.classes.get(name);
  }

  install(klass, selector, code, options = {}) {
    if (!(code instanceof Code)) throw new Error('A method needs compiled code.');
    return this.#method(klass, selector, { code, arity: code.args.length, format: 'bytecode' }, options);
  }

  installSource(klass, source, { protocol, expectedMethodId, selector: expectedSelector } = {}) {
    const { selector, code } = compileMethod(klass, source);
    if (expectedSelector !== undefined && selector !== expectedSelector) throw new Error(`Keep the selector ${expectedSelector}, or create a new method.`);
    if (expectedMethodId !== undefined && (klass.methods.get(selector)?.id ?? null) !== expectedMethodId) {
      throw new Error('The method has changed. Revert to load its current version before editing.');
    }
    return this.#method(klass, selector, { code, arity: code.args.length, format: 'source' }, { protocol });
  }

  evaluate(source, { receiver = null, processId = null, frameId = null, scope = null } = {}) {
    let parent = null;
    let owner = this.classOf(receiver);
    const scopes = [];
    if (processId !== null) {
      this.#paused(processId);
      const frame = frameId === null ? this.process(processId).frame : this.frame(processId, frameId);
      ({ receiver, environment: parent } = frame);
      scope = this.process(processId).scope;
      owner = frame.method.owner;
      for (let environment = parent; environment; environment = environment.parent) scopes.push(environment.names);
    }
    return this.startCode(receiver, compileExpression(owner, source, { scopes }), { parent, owner, scope });
  }

  primitive(klass, selector, arity, invoke, options = {}) {
    if (typeof invoke !== 'function' || !Number.isInteger(arity) || arity < 0) throw new Error('Invalid primitive.');
    return this.#method(klass, selector, { invoke, arity, format: 'primitive' }, options);
  }

  #method(klass, selector, body, { protocol = klass?.methods.get(selector)?.protocol ?? 'unclassified' } = {}) {
    if (klass?.runtime !== this || typeof selector !== 'string' || !selector) throw new Error('Invalid method owner or selector.');
    if (typeof protocol !== 'string' || !protocol.trim()) throw new Error('A method protocol needs a name.');
    const method = Object.freeze({ id: this.nextId++, owner: klass, selector, protocol, ...body });
    klass.methods.set(selector, method);
    this.methods.set(method.id, method);
    return method;
  }

  lookup(klass, selector) {
    for (let current = klass; current; current = current.superclass) {
      if (current.methods.has(selector)) return current.methods.get(selector);
    }
    return null;
  }

  start(receiver, selector, args = [], options = {}) {
    this.classOf(receiver);
    const code = new Code({
      literals: [...args, selector],
      bytes: assemble([
        ['self'], ...args.map((_, index) => ['constant', index]),
        ['send', args.length, args.length], ['return'],
      ]),
    });
    return this.startCode(receiver, code, options);
  }

  startCode(receiver, code, { parent = null, owner = this.classOf(receiver), scope = null } = {}) {
    this.classOf(receiver);
    if (scope !== null && scope.host?.runtime !== this) throw new Error('Host scope belongs to another runtime.');
    if (scope?.closed) throw new Error('The host scope is closed.');
    if (!(owner instanceof SmallClass) || owner.runtime !== this) throw new Error('Entry owner belongs to another runtime.');
    if (!(code instanceof Code) || code.args.length) throw new Error('Entry code must have no arguments.');
    const method = Object.freeze({ id: this.nextId++, owner, selector: '<entry>', code, arity: 0 });
    this.methods.set(method.id, method);
    const process = { id: this.nextId++, status: 'paused', stop: { reason: 'start' }, frame: null, result: null, action: null, scope, wait: null };
    process.frame = this.#frame(process, method, receiver, [], null, null, parent);
    scope?.track(process.id);
    this.processes.set(process.id, process);
    return process.id;
  }

  #frame(process, method, receiver, args, caller, block = null, parent = null) {
    const code = block?.code ?? method.code;
    if (args.length !== code.args.length) throw new Error(`Expected ${code.args.length} arguments, received ${args.length}.`);
    const id = this.nextId++;
    return {
      id, method, code, codePath: block?.codePath ?? [], receiver, caller, pc: 0, stack: [],
      environment: new Environment([...code.args, ...code.locals], args, block?.environment ?? parent),
      home: block?.home ?? { id, processId: process.id, active: true },
    };
  }

  process(id) {
    const process = this.processes.get(id);
    if (!process) throw new Error(`Unknown process: ${id}.`);
    return process;
  }

  dispose(id) {
    const process = this.process(id);
    if (!['completed', 'cancelled'].includes(process.status)) throw new Error('Dispose requires a completed or cancelled process.');
    this.processes.delete(id);
    process.scope?.processes.delete(id);
    return { id, status: 'disposed' };
  }

  frames(id) {
    const frames = [];
    for (let frame = this.process(id).frame; frame; frame = frame.caller) frames.push(frame);
    return frames;
  }

  frame(id, frameId) {
    const frame = this.frames(id).find(entry => entry.id === frameId);
    if (!frame) throw new Error(`Frame ${frameId} is not active in process ${id}.`);
    return frame;
  }

  inspect(id) {
    const process = this.process(id);
    return {
      id, status: process.status, stop: process.stop, result: process.result,
      action: process.action ? { ...process.action } : null,
      frames: this.frames(id).map(frame => {
        const scopes = [];
        for (let environment = frame.environment; environment; environment = environment.parent) {
          scopes.push(Object.fromEntries(environment.names.map((name, index) => [name, environment.values[index]])));
        }
        return {
          id: frame.id, methodId: frame.method.id, selector: frame.method.selector, codePath: [...frame.codePath],
          className: frame.method.owner.name, receiver: frame.receiver,
          pc: frame.pc, instruction: decode(frame.code.bytes, frame.pc),
          source: frame.code.source, position: frame.code.positions.find(position => position.pc === frame.pc) ?? null,
          scopes, stack: [...frame.stack], pendingSend: frame === process.frame ? this.#pendingSend(frame) : null,
        };
      }),
    };
  }

  setVariable(id, frameId, name, value, { depth = null } = {}) {
    this.#paused(id);
    this.classOf(value);
    const scope = this.frame(id, frameId).environment;
    const binding = depth === null ? scope.find(name) : { environment: scope.scope(depth) };
    const { environment } = binding;
    const index = binding.index ?? environment.names.indexOf(name);
    if (index < 0) throw new Error(`Unknown variable in scope ${depth}: ${name}.`);
    environment.values[index] = value;
  }

  #pendingSend(frame) {
    const { op, args } = decode(frame.code.bytes, frame.pc);
    if (![Op.send, Op.superSend].includes(op) || frame.stack.length < args[1] + 1) return null;
    return {
      selector: frame.code.literals[args[0]], super: op === Op.superSend,
      receiver: frame.stack.at(-args[1] - 1), arguments: frame.stack.slice(frame.stack.length - args[1]),
    };
  }

  setSendOperand(id, frameId, index, value) {
    const process = this.#paused(id);
    this.classOf(value);
    const frame = this.frame(id, frameId);
    const send = frame === process.frame ? this.#pendingSend(frame) : null;
    if (!send) throw new Error('Operand edits require the current frame to be paused at a send.');
    if (!Number.isSafeInteger(index) || index < 0 || index > send.arguments.length) throw new Error('Invalid send operand index.');
    if (send.super && index === 0 && value !== frame.receiver) throw new Error('A super send uses the frame receiver.');
    frame.stack[frame.stack.length - send.arguments.length - 1 + index] = value;
  }

  breakpoint(method, pc = 0, code = method.code) {
    const contains = candidate => candidate === code || candidate?.literals.some(value => value instanceof Code && contains(value));
    if (this.methods.get(method.id) !== method || !(code instanceof Code) || !contains(method.code) || !code.boundaries.includes(pc)) {
      throw new Error('Breakpoint needs a method and instruction position.');
    }
    const id = this.nextId++;
    this.breakpoints.set(id, { method, code, pc });
    return id;
  }

  clearBreakpoint(id) {
    if (!this.breakpoints.delete(id)) throw new Error(`Unknown breakpoint: ${id}.`);
  }

  #paused(id) {
    const process = this.process(id);
    if (process.status !== 'paused') throw new Error(`Process ${id} is ${process.status}.`);
    return process;
  }

  run(id, { budget = 10000 } = {}) {
    return this.#drive(id, budget, 'run');
  }

  resume(id, { budget = 10000 } = {}) {
    return this.#drive(id, budget);
  }

  step(id) {
    return this.#drive(id, 1, 'step');
  }

  stepOver(id, { budget = 10000 } = {}) {
    return this.#drive(id, budget, 'stepOver');
  }

  stepOut(id, { budget = 10000 } = {}) {
    return this.#drive(id, budget, 'stepOut');
  }

  retry(id, { budget = 10000 } = {}) {
    const process = this.#paused(id);
    if (process.stop.reason !== 'error') throw new Error('Retry requires a failed instruction.');
    return this.#drive(id, budget, null, true);
  }

  pause(id) {
    const process = this.#paused(id);
    if (process.stop.reason !== 'error') process.stop = { reason: 'pause' };
    return this.inspect(id);
  }

  whenReady(id) {
    const process = this.process(id);
    if (process.status !== 'waiting') throw new Error('The process is not waiting.');
    return process.wait.completion;
  }

  cancel(id) {
    const process = this.process(id);
    if (!['paused', 'waiting'].includes(process.status)) throw new Error(`Process ${id} is ${process.status}.`);
    const wait = process.wait;
    process.wait = null;
    for (const frame of this.frames(id)) if (frame.home.id === frame.id) frame.home.active = false;
    process.frame = null;
    process.action = null;
    process.status = 'cancelled';
    process.stop = { reason: 'cancelled' };
    if (wait) {
      wait.token.runtime = null;
      wait.resolve();
      const cancel = wait.cancel;
      wait.cancel = null;
      cancel?.();
    }
    return this.inspect(id);
  }

  #wait(process, operation, next, count) {
    const token = { runtime: this };
    const { promise: completion, resolve } = Promise.withResolvers();
    process.wait = { token, next, count, cancel: operation.cancel, completion, resolve };
    process.status = 'waiting';
    process.stop = { reason: 'await' };
    Runtime.#observe(process.scope ? process.scope.task(operation.promise) : operation.promise, process.id, token);
  }

  static #observe(promise, id, token) {
    Promise.resolve(promise).then(
      value => token.runtime?.#settle(id, token, false, value),
      error => token.runtime?.#settle(id, token, true, error),
    );
  }

  #settle(id, token, failed, value) {
    const process = this.processes.get(id);
    if (process?.status !== 'waiting' || process.wait.token !== token) return;
    const wait = process.wait;
    token.runtime = null;
    if (!failed) {
      try { this.classOf(value); } catch (error) { failed = true; value = error; }
    }
    process.wait = null;
    wait.cancel = null;
    process.status = 'paused';
    if (failed) process.stop = { reason: 'error', error: value };
    else {
      const frame = process.frame;
      frame.stack.splice(frame.stack.length - wait.count - 1, wait.count + 1, value);
      frame.pc = wait.next;
      process.stop = { reason: this.#actionComplete(process) ? 'step' : 'ready' };
      if (process.stop.reason === 'step') process.action = null;
    }
    wait.resolve();
  }

  #actionComplete(process) {
    const action = process.action;
    if (!action) return false;
    if (action.kind === 'step') return true;
    if (action.kind === 'stepOver' && process.frame?.id === action.frameId) return true;
    for (let frame = process.frame; frame; frame = frame.caller) if (frame.id === action.frameId) return false;
    return true;
  }

  #drive(id, budget, mode = null, retry = false) {
    const process = this.#paused(id);
    if (process.stop.reason === 'error' && !retry) throw new Error('Use retry after inspecting the failed instruction.');
    this.#budget(budget);
    const continuing = mode === process.action?.kind && process.stop.reason === 'budget';
    const starting = mode !== null && !continuing;
    if (starting) process.action = mode === 'run' ? null : { kind: mode, frameId: process.frame.id };
    const initial = { frame: process.frame, pc: process.frame.pc };
    const skip = (starting && mode !== 'run') || retry || process.stop.reason === 'breakpoint';
    process.status = 'running';
    process.stop = null;
    let count = 0;
    while (process.status === 'running' && count < budget) {
      const frame = process.frame;
      const breakpoint = [...this.breakpoints.entries()].find(([, point]) =>
        point.method === frame.method && point.code === frame.code && point.pc === frame.pc);
      if (breakpoint && !(skip && count === 0 && frame === initial.frame && frame.pc === initial.pc)) {
        process.status = 'paused';
        process.stop = { reason: 'breakpoint', breakpointId: breakpoint[0] };
        break;
      }
      try {
        this.#execute(process);
      } catch (error) {
        process.status = 'paused';
        process.stop = { reason: 'error', error };
        break;
      }
      count++;
      if (process.status === 'running' && this.#actionComplete(process)) break;
    }
    if (process.status === 'running') {
      process.status = 'paused';
      process.stop = { reason: this.#actionComplete(process) ? 'step' : 'budget' };
    }
    if (process.status === 'completed' || process.stop?.reason === 'step') process.action = null;
    return this.inspect(id);
  }

  #budget(budget) {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Execution budget must be a positive integer.');
  }

  #execute(process) {
    const frame = process.frame;
    const { op, args, next } = decode(frame.code.bytes, frame.pc);
    const literal = frame.code.literals[args[0]];
    const stack = frame.stack;
    const need = count => { if (stack.length < count) throw new Error('Operand stack underflow.'); };
    switch (op) {
      case Op.constant: this.classOf(literal); stack.push(literal); break;
      case Op.self: stack.push(frame.receiver); break;
      case Op.read: stack.push(frame.environment.at(...args).values[args[1]]); break;
      case Op.write: need(1); frame.environment.at(...args).values[args[1]] = stack.at(-1); break;
      case Op.slot:
      case Op.storeSlot: {
        const receiver = frame.receiver;
        const store = receiver instanceof SmallObject ? receiver.slots
          : receiver instanceof SmallClass && !receiver.meta ? receiver.slotValues : null;
        const layout = receiver instanceof SmallObject ? receiver.klass.slots : receiver?.metaclass?.slots;
        if (!store || !layout.includes(literal)) throw new Error(`Unknown instance slot: ${literal}.`);
        if (op === Op.slot) stack.push(Object.hasOwn(store, literal) ? store[literal] : null);
        else { need(1); store[literal] = stack.at(-1); }
        break;
      }
      case Op.block: stack.push(new Block(frame, literal, args[0])); break;
      case Op.global: {
        const klass = this.classes.get(literal);
        if (!klass) throw Object.assign(new Error(`Undefined name: ${literal}.`), { name: 'UndefinedName', variable: literal });
        stack.push(klass);
        break;
      }
      case Op.pop: need(1); stack.pop(); break;
      case Op.dup: need(1); stack.push(stack.at(-1)); break;
      case Op.send:
      case Op.superSend: {
        const count = args[1];
        need(count + 1);
        let receiver = stack[stack.length - count - 1];
        let selector = literal;
        let arguments_ = stack.slice(stack.length - count);
        let klass = op === Op.superSend ? frame.method.owner.superclass : this.classOf(receiver);
        let called = null;
        let result;
        for (;;) {
          const method = this.lookup(klass, selector);
          if (!method) {
            const error = new Error(`${this.classOf(receiver).name} does not understand ${selector}.`);
            error.name = 'MessageNotUnderstood';
            error.receiver = receiver;
            error.selector = selector;
            error.arguments = arguments_;
            throw error;
          }
          if (arguments_.length !== method.arity) throw new Error(`${selector} expects ${method.arity} arguments.`);
          if (method.code) {
            called = this.#frame(process, method, receiver, arguments_, frame);
            break;
          }
          result = method.invoke(receiver, arguments_, { processId: process.id, scope: process.scope });
          if (!(result instanceof SendCall)) break;
          ({ receiver, selector, args: arguments_ } = result);
          this.classOf(receiver);
          klass = this.classOf(receiver);
        }
        if (result instanceof HostOperation) {
          this.#wait(process, result, next, count);
          return;
        }
        if (result instanceof BlockCall) {
          this.classOf(result.block);
          called = this.#frame(process, result.block.method, result.block.receiver, result.args, frame, result.block);
        } else if (!called) this.classOf(result);
        stack.splice(stack.length - count - 1);
        frame.pc = next;
        if (called) process.frame = called;
        else stack.push(result);
        return;
      }
      case Op.return:
      case Op.nonlocalReturn: {
        need(1);
        let target = frame;
        if (op === Op.nonlocalReturn) {
          if (!frame.home.active || frame.home.processId !== process.id) throw new Error('The block home activation has ended or belongs to another process.');
          while (target && target.id !== frame.home.id) target = target.caller;
          if (!target) throw new Error('The block home activation is outside this call chain.');
        }
        const result = stack.at(-1);
        for (let current = frame; current !== target.caller; current = current.caller) {
          if (current.home.id === current.id) current.home.active = false;
        }
        process.frame = target.caller;
        if (process.frame) process.frame.stack.push(result);
        else {
          process.status = 'completed';
          process.stop = { reason: 'return' };
          process.result = result;
        }
        return;
      }
      case Op.jump: frame.pc = args[0]; return;
      case Op.jumpFalse:
        need(1);
        if (typeof stack.at(-1) !== 'boolean') throw new Error('Conditional jump requires a Boolean.');
        frame.pc = stack.pop() ? next : args[0];
        return;
      default: throw new Error(`Unknown opcode: ${op}.`);
    }
    frame.pc = next;
  }
}
