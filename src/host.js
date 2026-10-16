import { Block, SmallClass, SmallObject } from './runtime.js';
import { HostOperation, HostValue } from './host-value.js';

export class Host {
  constructor(runtime, runner) {
    if (runner.runtime !== runtime) throw new Error('Host and runner require the same runtime.');
    if (runtime.host) throw new Error('The runtime already has a host interface.');
    this.runtime = runtime;
    this.runner = runner;
    this.objects = new WeakMap();
    this.undefined = new HostValue(runtime, undefined);
    runtime.host = this;
    const klass = runtime.classes.get('HostObject');
    runtime.primitive(klass, 'get:', 1, (receiver, [name]) => this.value(Reflect.get(this.object(receiver), this.#name(name))));
    runtime.primitive(klass, 'set:to:', 2, (receiver, [name, value]) => {
      if (!Reflect.set(this.object(receiver), this.#name(name), this.unwrap(value))) throw new Error(`Cannot set host property ${name}.`);
      return value;
    });
    for (let count = 0; count <= 4; count++) {
      const suffix = 'with:'.repeat(count);
      runtime.primitive(klass, `call:${suffix}`, count + 1, (receiver, [name, ...args]) => {
        const object = this.object(receiver);
        return this.#result(Reflect.apply(Reflect.get(object, this.#name(name)), object, args.map(value => this.unwrap(value))));
      });
      runtime.primitive(klass, count ? `invokeWith:${'with:'.repeat(count - 1)}` : 'invoke', count, (receiver, args) =>
        this.#result(Reflect.apply(this.object(receiver), undefined, args.map(value => this.unwrap(value)))));
    }
    runtime.primitive(klass, 'isUndefined', 0, receiver => receiver.value === undefined);
    runtime.primitive(klass, 'on:do:', 2, (receiver, [type, block], { scope }) => {
      if (!scope) throw new Error('Event listeners require a host scope.');
      scope.listen(receiver, type, block);
      return receiver;
    });
  }

  #name(name) {
    if (typeof name !== 'string') throw new Error('Host property names must be strings.');
    return name;
  }

  value(value) {
    if (value === undefined) return this.undefined;
    if (value === null || ['boolean', 'bigint', 'number', 'string'].includes(typeof value)) return value;
    if (value instanceof SmallObject || value instanceof SmallClass || value instanceof Block || value instanceof HostValue) {
      this.runtime.classOf(value);
      return value;
    }
    if (!['object', 'function'].includes(typeof value)) throw new Error(`Unsupported host value: ${typeof value}.`);
    let wrapped = this.objects.get(value);
    if (!wrapped) {
      wrapped = new HostValue(this.runtime, value);
      this.objects.set(value, wrapped);
    }
    return wrapped;
  }

  unwrap(value) {
    this.runtime.classOf(value);
    return value instanceof HostValue ? value.value : value;
  }

  object(value) {
    const object = this.unwrap(value);
    if (object === null || !['object', 'function'].includes(typeof object)) throw new Error('Host access requires an object or function.');
    return object;
  }

  #result(value) {
    if (value instanceof HostOperation) {
      return new HostOperation(Host.#convert(value.promise, new WeakRef(this)), { cancel: value.cancel });
    }
    if (value && typeof value.then === 'function') {
      return new HostOperation(Host.#convert(value, new WeakRef(this)));
    }
    return this.value(value);
  }

  static #convert(promise, reference) {
    return Promise.resolve(promise).then(value => reference.deref()?.value(value));
  }

  scope() {
    return new HostScope(this);
  }
}

export class HostScope {
  constructor(host) {
    this.host = host;
    this.processes = new Set();
    this.listeners = new Set();
    this.tasks = new Set();
    this.taskPromises = new WeakMap();
    this.closed = false;
  }

  track(id) {
    if (this.closed) throw new Error('The host scope is closed.');
    this.processes.add(id);
  }

  task(promise) {
    if (this.closed) throw new Error('The host scope is closed.');
    if (!promise || typeof promise.then !== 'function') throw new Error('A host task requires a promise.');
    const existing = this.taskPromises.get(promise);
    if (existing) return existing;
    const task = {};
    this.tasks.add(task);
    const tracked = Promise.resolve(promise).then(value => {
      this.tasks.delete(task);
      return value;
    }, error => {
      this.tasks.delete(task);
      throw error;
    });
    this.taskPromises.set(promise, tracked);
    this.taskPromises.set(tracked, tracked);
    return tracked;
  }

  own(cleanup) {
    if (this.closed) throw new Error('The host scope is closed.');
    if (typeof cleanup !== 'function') throw new Error('Resource cleanup requires a function.');
    const remove = () => {
      const result = cleanup();
      if (result && typeof result.then === 'function') return Promise.resolve(result).then(() => { this.listeners.delete(remove); });
      this.listeners.delete(remove);
    };
    this.listeners.add(remove);
    return remove;
  }

  start(receiver, selector, args = []) {
    if (this.closed) throw new Error('The host scope is closed.');
    const id = this.host.runtime.start(receiver, selector, args, { scope: this });
    this.host.runner.follow(id);
    return id;
  }

  listen(target, type, block) {
    if (this.closed) throw new Error('The host scope is closed.');
    this.host.runtime.classOf(block);
    if (!(block instanceof Block) || block.code.args.length > 1) throw new Error('Event callbacks require a block with zero or one argument.');
    if (typeof type !== 'string') throw new Error('Event types must be strings.');
    const object = this.host.object(target);
    if (typeof object.addEventListener !== 'function' || typeof object.removeEventListener !== 'function') throw new Error('The host object is not an event target.');
    const callback = event => {
      if (this.closed) return;
      this.start(block, block.code.args.length ? 'value:' : 'value', block.code.args.length ? [this.host.value(event)] : []);
    };
    object.addEventListener(type, callback);
    const remove = () => {
      object.removeEventListener(type, callback);
      this.listeners.delete(remove);
    };
    this.listeners.add(remove);
    return remove;
  }

  reap({ keep = null, retain = new Set() } = {}) {
    for (const id of this.processes) {
      const process = this.host.runtime.process(id);
      if (id !== keep && !retain.has(id) && ['completed', 'cancelled'].includes(process.status)) {
        this.host.runner.forget(id);
        this.host.runtime.dispose(id);
      }
    }
  }

  dispose() {
    if (this.closed && this.listeners.size === 0 && this.processes.size === 0) return;
    this.closed = true;
    const errors = [];
    const pending = [];
    for (const remove of this.listeners) {
      try {
        const result = remove();
        if (result && typeof result.then === 'function') pending.push(Promise.resolve(result).catch(error => { errors.push(error); }));
      } catch (error) { errors.push(error); }
    }
    for (const id of [...this.processes]) {
      this.host.runner.forget(id);
      try {
        const process = this.host.runtime.process(id);
        if (['paused', 'waiting'].includes(process.status)) this.host.runtime.cancel(id);
      } catch (error) { errors.push(error); }
      try { this.host.runtime.dispose(id); } catch (error) { errors.push(error); }
    }
    const finish = () => { if (errors.length) throw new AggregateError(errors, 'Host scope disposal failed.'); };
    if (pending.length) return Promise.all(pending).then(finish);
    finish();
  }
}
