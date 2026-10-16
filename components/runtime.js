import { Debugger, Host, HostOperation, Inspectors, ProcessRunner, Runtime } from '../src/index.js';
import { checkSize, decode, encode, errorData, referenceKey, validateReference } from './values.js';
import { selectorParts, validateManifest } from './manifest.js';

export class ComponentRuntime {
  constructor({ namespace, name, incarnation = crypto.randomUUID(), host, debugger: debugger_, source, remote,
    maxActive = 256, maxCalls = 1024, changed = () => {}, failed = () => {} }) {
    if (![maxActive, maxCalls].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Call limits must be positive integers.');
    this.maxActive = maxActive;
    this.maxCalls = maxCalls;
    this.identity = { namespace, runtime: name, incarnation };
    this.runtime = host?.runtime ?? new Runtime();
    this.runner = host?.runner ?? new ProcessRunner(this.runtime);
    this.host = host ?? new Host(this.runtime, this.runner);
    this.debugger = debugger_ ?? new Debugger(this.runtime);
    this.ownsRuntime = !host;
    this.inspectors = this.ownsRuntime ? new Inspectors(this.host, this.debugger) : null;
    this.source = source;
    this.remote = remote;
    this.changed = changed;
    this.failed = failed;
    this.modules = new Map();
    this.workspaceClasses = new Map();
    this.instances = new Map();
    this.wrappers = new WeakMap();
    this.references = new Map();
    this.values = new WeakMap();
    this.calls = new Map();
    this.processCalls = new Map();
    this.observers = new Set();
    this.unsubscribe = this.runner.subscribe(id => this.updateCall(id));
    this.closed = false;
  }

  reference(id) { return { ...this.identity, id }; }

  local(reference) {
    validateReference(reference);
    return ['namespace', 'runtime', 'incarnation'].every(key => reference[key] === this.identity[key]);
  }

  get(reference) {
    if (!this.local(reference)) throw new Error('Object reference belongs to another runtime incarnation.');
    const instance = this.instances.get(reference.id);
    if (!instance) throw new Error(`Unknown component instance: ${reference.id}.`);
    return instance;
  }

  intern(reference) {
    const key = referenceKey(reference);
    if (!this.references.has(key)) {
      const value = Object.freeze(validateReference(reference));
      this.references.set(key, value);
      this.values.set(value, value);
    }
    return this.references.get(key);
  }

  encode(value) { return encode(value, { reference: value => this.values.get(value) }); }
  decode(value) { return decode(value, { reference: value => this.intern(value) }); }

  async load(version) {
    if (this.closed) throw new Error('The component runtime is closed.');
    let record = this.modules.get(version);
    if (record) {
      await record.loading;
      if (record.error) throw Object.assign(new Error(record.error.message), record.error);
      return record;
    }
    record = { version, status: 'loading', error: null };
    this.modules.set(version, record);
    record.loading = (async () => {
      try {
        const source = await this.source(version);
        const expected = this.identity.runtime === 'server' ? 'server' : 'browser';
        if (source.manifest.target !== expected) throw new Error(`Module targets ${source.manifest.target}, while this runtime is ${expected}.`);
        record.source = source;
        const module = await import(source.loadUrl);
        const factory = module[source.manifest.factory];
        if (typeof factory !== 'function') throw new Error(`Missing factory export: ${source.manifest.factory}.`);
        record.factory = factory;
        record.klass = this.defineWrapper(source);
        record.status = 'ready';
      } catch (error) {
        record.status = 'failed'; record.error = errorData(error);
      }
      this.changed({ type: 'module', ...this.describeModule(record) });
    })();
    return this.load(version);
  }

  describeModule(record) {
    return { version: record.version, status: record.status, error: record.error,
      manifest: record.source?.manifest ?? null, sourceUrl: record.source?.loadUrl ?? null };
  }

  defineWrapper(source) {
    const declaration = source.manifest.interface;
    const klass = this.runtime.defineClass(`${declaration.className}V${source.version}`, {
      category: source.manifest.smallslop?.category ?? 'Components', slots: ['id', 'version', 'service'],
    });
    this.defineMessages(klass, declaration.messages);
    for (const method of source.manifest.smallslop?.methods ?? []) this.runtime.installSource(klass, method.source, { protocol: method.protocol });
    return klass;
  }

  defineMessages(klass, messages) {
    let index = 0;
    for (const selector of Object.keys(messages).sort()) {
      const message = messages[selector];
      const args = Array.from({ length: message.arity }, (_, i) => `argument${i}`);
      const parts = selectorParts(selector, message.arity);
      const signature = parts.length === 1 && !selector.endsWith(':') ? `${selector} ${args.join(' ')}`
        : parts.map((part, i) => `${part} ${args[i]}`).join(' ');
      const internal = `componentCall${index++}${args.length ? ':' + 'with:'.repeat(args.length - 1) : ''}`;
      this.runtime.primitive(klass, internal, args.length, (receiver, values, { processId }) =>
        this.invoke(this.wrappers.get(receiver), selector, values, processId), { protocol: 'host implementation' });
      const invocation = args.length ? internal.match(/\w+:/g).map((part, i) => `${part} ${args[i]}`).join(' ') : internal;
      this.runtime.installSource(klass, `${signature}\n  ^self ${invocation}`, { protocol: 'published messages' });
    }
    return klass;
  }

  register({ id, wrapper, object, messages, workspace }) {
    if (this.closed) throw new Error('The component runtime is closed.');
    if (this.instances.has(id) || this.values.has(object) || this.values.has(wrapper)) throw new Error('The workspace object is already registered.');
    const klass = this.runtime.classOf(wrapper);
    const manifest = validateManifest({ name: workspace.kind, target: 'browser', interface: { className: klass.name, messages } });
    for (const message of Object.values(manifest.interface.messages)) {
      if (typeof object[message.method] !== 'function') throw new Error(`Missing workspace method: ${message.method}.`);
    }
    const declared = JSON.stringify(manifest.interface.messages);
    if (this.workspaceClasses.has(klass) && this.workspaceClasses.get(klass) !== declared) throw new Error('Workspace class messages differ from its registered interface.');
    if (!this.workspaceClasses.has(klass)) {
      this.defineMessages(klass, manifest.interface.messages);
      this.workspaceClasses.set(klass, declared);
    }
    const reference = this.intern(this.reference(id));
    const instance = { id, reference, workspace: structuredClone(workspace), module: { version: null, source: { manifest } },
      scope: this.host.scope(), status: 'ready', revision: 0, error: null, configuration: encode({}), bindings: {}, object, wrapper, mounted: null };
    wrapper.slots.service = this.host.value(object);
    this.instances.set(id, instance);
    this.wrappers.set(wrapper, instance);
    this.values.set(object, reference);
    this.values.set(wrapper, reference);
    this.notify(instance);
    return this.describe(instance);
  }

  async create({ version, configuration = { kind: 'record', value: {} }, bindings = {}, state, savedSnapshot = null, id = crypto.randomUUID() }) {
    const module = await this.load(version);
    if (this.instances.has(id)) throw new Error(`Component instance already exists: ${id}.`);
    const reference = this.intern(this.reference(id));
    const scope = this.host.scope();
    const events = new AbortController();
    scope.own(() => events.abort());
    const instance = { id, reference, module, scope, status: 'constructing', revision: 0, error: null,
      configuration, bindings: {}, object: null, wrapper: null, mounted: null, savedSnapshot };
    this.instances.set(id, instance);
    try {
      const required = module.source.manifest.bindings;
      for (const name of Object.keys(bindings)) if (!Object.hasOwn(required, name)) throw new Error(`Undeclared component binding: ${name}.`);
      for (const name of Object.keys(required)) {
        if (!bindings[name]) throw new Error(`Missing component binding: ${name}.`);
        await this.checkBinding(bindings[name], required[name]);
        instance.bindings[name] = { target: this.intern(bindings[name]), revision: 0 };
      }
      const context = {
        self: reference,
        signal: events.signal,
        binding: name => {
          if (!instance.bindings[name]) throw new Error(`Unknown component binding: ${name}.`);
          return instance.bindings[name].target;
        },
        send: (target, selector, args = [], options = {}) => this.send(target, selector, args, { ...options, owner: instance }),
        observe: (name, listener) => this.observe(instance, name, listener),
        action: (selector, { releaseOnSuccess = false } = {}) => () => {
          try {
            const call = this.start({ target: reference, selector, args: encode([]) });
            if (releaseOnSuccess) void this.completed(call.id).then(() => this.release(call.id, true)).catch(error => this.failed(error));
          }
          catch (error) { this.failed(error); }
        },
        own: cleanup => scope.own(cleanup),
        task: promise => scope.task(promise),
        operation: (promise, cancel) => new HostOperation(promise, { cancel }),
        report: error => { instance.error = errorData(error); this.notify(instance); this.failed(error); },
        changed: () => this.objectChanged(reference),
      };
      instance.object = await module.factory(this.decode(configuration), context);
      if (!instance.object || !['object', 'function'].includes(typeof instance.object)) throw new Error('A component factory must return an object.');
      if (this.values.has(instance.object)) throw new Error('The factory returned an object already registered in this runtime.');
      for (const message of Object.values(module.source.manifest.interface.messages)) {
        if (typeof instance.object[message.method] !== 'function') throw new Error(`Missing component method: ${message.method}.`);
      }
      if (state !== undefined) {
        if (typeof instance.object.restore !== 'function') throw new Error('The component has no restore method.');
        await instance.object.restore(this.decode(state));
      }
      instance.wrapper = this.runtime.newObject(module.klass);
      Object.assign(instance.wrapper.slots, { id, version, service: this.host.value(instance.object) });
      this.wrappers.set(instance.wrapper, instance);
      this.values.set(instance.object, reference);
      this.values.set(instance.wrapper, reference);
      instance.status = 'ready';
      this.notify(instance);
      for (const observer of this.observers) if (observer.owner === instance) this.scheduleObservation(observer);
      return this.describe(instance);
    } catch (error) {
      instance.status = 'failed'; instance.error = errorData(error); this.notify(instance);
      throw Object.assign(error, { component: reference });
    }
  }

  notify(instance) {
    this.changed({ type: 'instance', ...this.describe(instance) });
    for (const observer of this.observers) {
      if (referenceKey(observer.owner.bindings[observer.name].target) === referenceKey(instance.reference)) this.scheduleObservation(observer);
    }
  }

  objectChanged(target) {
    const instance = this.get(target);
    instance.revision++;
    this.notify(instance);
  }

  observe(owner, name, listener) {
    if (typeof listener !== 'function') throw new Error('An observation requires a listener.');
    const binding = owner.bindings[name];
    if (!binding || !this.local(binding.target)) throw new Error('Observe requires a declared binding in this runtime.');
    const observer = { owner, name, listener, dirty: false, pending: null };
    this.observers.add(observer);
    if (owner.status === 'ready') this.scheduleObservation(observer);
    return owner.scope.own(() => this.observers.delete(observer));
  }

  scheduleObservation(observer) {
    if (this.closed || observer.owner.scope.closed) return;
    observer.dirty = true;
    if (observer.pending || observer.owner.status !== 'ready') return;
    const { owner } = observer;
    observer.pending = owner.scope.task(Promise.resolve().then(async () => {
      while (observer.dirty && this.observers.has(observer) && owner.status === 'ready') {
        observer.dirty = false;
        await observer.listener(this.describe(this.get(owner.bindings[observer.name].target)));
      }
    })).catch(error => {
      observer.dirty = false;
      owner.error = errorData(error); this.notify(owner); this.failed(error);
    }).finally(() => {
      observer.pending = null;
      if (observer.dirty && this.observers.has(observer)) this.scheduleObservation(observer);
    });
  }

  active(instance) {
    return [...this.calls.values()].filter(call => call.target.id === instance.id && !['completed', 'cancelled'].includes(call.status));
  }

  activeProcesses(instance) {
    return [...this.runtime.processes.values()].filter(process => !['completed', 'cancelled'].includes(process.status)
      && this.runtime.frames(process.id).some(frame => frame.receiver === instance.wrapper)).map(process => process.id);
  }

  describe(instance) {
    return { reference: instance.reference, version: instance.module.version, className: instance.module.source.manifest.interface.className,
      workspace: instance.workspace ?? null,
      status: instance.status, revision: instance.revision, configuration: instance.configuration, bindings: instance.bindings,
      messages: instance.module.source.manifest.interface.messages, activeCalls: this.active(instance).map(call => call.id),
      activeProcesses: this.activeProcesses(instance),
      hostTasks: instance.scope.tasks.size, error: instance.error, pane: instance.mounted, savedSnapshot: instance.savedSnapshot ?? null };
  }

  sourceOf(instance) {
    if (instance.workspace) throw new Error('Save source through an installed component.');
    const klass = instance.wrapper.klass;
    const methods = [...klass.methods.values()].filter(method => !(method.format === 'primitive' && method.selector.startsWith('componentCall')))
      .sort((a, b) => a.selector.localeCompare(b.selector)).map(method => {
        if (method.format !== 'source') throw new Error(`Method ${method.selector} has no Smallslop source to save.`);
        return { source: method.code.source, protocol: method.protocol };
      });
    return { manifest: { ...instance.module.source.manifest, smallslop: { category: klass.category, methods } }, files: instance.module.source.files };
  }

  async snapshot(target) {
    const instance = this.get(target);
    if (instance.status !== 'ready') throw new Error(`Component ${instance.id} is ${instance.status}.`);
    this.assertIdle(instance);
    const source = this.sourceOf(instance);
    const revision = instance.revision;
    instance.status = 'snapshotting'; this.notify(instance);
    try {
      let state;
      if (typeof instance.object.snapshot === 'function') {
        if (typeof instance.object.restore !== 'function') throw new Error('Saving declared state requires a restore method.');
        const value = await instance.scope.task(Promise.resolve().then(() => instance.object.snapshot()));
        state = encode(value, { reference: value => {
          if (this.values.has(value)) throw new Error('Save object relationships through declared bindings.');
        } });
      }
      if (revision !== instance.revision || JSON.stringify(source) !== JSON.stringify(this.sourceOf(instance))) throw new Error('Component changed while saving. Save its current state again.');
      return { ...source, revision, configuration: instance.configuration, ...(state === undefined ? {} : { state }) };
    } catch (error) { instance.error = errorData(error); throw error; }
    finally {
      instance.status = 'ready'; this.notify(instance);
      for (const observer of this.observers) if (observer.owner === instance && observer.dirty) this.scheduleObservation(observer);
    }
  }

  async checkBinding(target, required) {
    const state = this.local(target) ? this.describe(this.get(target)) : await this.remote({ op: 'objects.inspect', target });
    if (state.status !== 'ready') throw new Error(`Binding target is ${state.status}.`);
    for (const selector of required) if (!Object.hasOwn(state.messages, selector)) throw new Error(`Binding target does not publish ${selector}.`);
    return state;
  }

  start({ target, selector, args = encode([]), id = crypto.randomUUID(), parentCall = null, job = null }) {
    this.admitCall();
    const instance = this.get(target);
    if (instance.status !== 'ready') throw new Error(`Component ${instance.id} is ${instance.status}.`);
    if (!Object.hasOwn(instance.module.source.manifest.interface.messages, selector)) throw new Error(`Unpublished component message: ${selector}.`);
    if (this.calls.has(id)) throw new Error(`Call already exists: ${id}.`);
    const values = this.decode(args);
    if (!Array.isArray(values)) throw new Error('Message arguments require an encoded array.');
    if (job) {
      if (this.identity.runtime !== 'server') throw new Error('Component jobs require a server instance.');
      if (typeof job.label !== 'string' || !job.input || typeof job.input !== 'object' || Array.isArray(job.input)) throw new Error('A job requires a label and input record.');
      job = JSON.parse(JSON.stringify(checkSize(job, 65536)));
    }
    const processId = this.runtime.start(instance.wrapper, selector, values.map(value => this.host.value(value)), { scope: instance.scope });
    const timestamp = new Date().toISOString();
    const call = { id, target: instance.reference, version: instance.module.version, selector, args, parentCall, processId,
      status: 'running', execution: 'pending', export: 'pending', error: null, result: null, retained: false, waiters: new Set(),
      job, progress: null, publishing: false, startedAt: timestamp, updatedAt: timestamp };
    this.calls.set(id, call);
    this.processCalls.set(processId, call);
    this.notifyCall(call);
    this.runner.follow(processId);
    return this.describeCall(call);
  }

  invoke(instance, selector, values, processId) {
    if (instance.status !== 'ready') throw new Error(`Component ${instance.id} is ${instance.status}.`);
    const message = instance.module.source.manifest.interface.messages[selector];
    const call = this.processCalls.get(processId);
    const controller = new AbortController();
    let active = true;
    if (call) { call.execution = 'running'; call.error = null; this.notifyCall(call); }
    const requireActive = () => {
      controller.signal.throwIfAborted();
      if (!active || !call || call.status === 'cancelled') throw new Error('Call context requires an active component API call.');
    };
    const context = message.context ? {
      signal: controller.signal,
      call: structuredClone({ id: call?.id ?? null, target: instance.reference, version: instance.module.version, selector,
        args: call?.args ?? null, input: call?.job?.input ?? null }),
      setProgress: progress => {
        requireActive();
        if (!progress || typeof progress !== 'object' || Array.isArray(progress)) throw new Error('Progress requires a record.');
        call.progress = JSON.parse(JSON.stringify(checkSize(progress, 4096)));
        this.notifyCall(call);
      },
      beginPublication: () => { requireActive(); call.publishing = true; this.notifyCall(call); },
    } : null;
    const settled = (failed, value) => {
      active = false;
      if (call) {
        call.execution = failed ? 'failed' : 'completed';
        if (failed) call.error = errorData(value);
        else call.rawResult = value;
        if (call.status === 'cancelled') this.notifyCall(call);
      }
      if (failed) throw value;
      return this.host.value(value);
    };
    let result;
    try {
      const args = values.map(value => this.host.unwrap(value));
      if (message.context) args.push(context);
      result = Reflect.apply(instance.object[message.method], instance.object, args);
    }
    catch (error) { return settled(true, error); }
    if (result instanceof HostOperation || result && typeof result.then === 'function') {
      const operation = result instanceof HostOperation ? result : new HostOperation(result);
      return new HostOperation(instance.scope.task(Promise.resolve(operation.promise).then(value => settled(false, value), error => settled(true, error))), {
        cancel: () => { controller.abort(); operation.cancel?.(); },
      });
    }
    return settled(false, result);
  }

  updateCall(processId) {
    const call = this.processCalls.get(processId);
    if (!call) return;
    const process = this.runtime.process(processId);
    call.status = process.status === 'paused' && ['start', 'budget', 'ready'].includes(process.stop.reason) ? 'running' : process.status;
    if (call.status === 'paused') call.retained = true;
    if (process.stop?.reason === 'error') call.error = errorData(process.stop.error);
    if (process.status === 'completed' && call.export === 'pending') {
      call.execution = 'completed'; call.error = null;
      try {
        const value = this.host.unwrap(process.result);
        call.rawResult = value;
        const message = this.get(call.target).module.source.manifest.interface.messages[call.selector];
        if (message.result === 'reference' && !this.values.has(value)) throw new Error('A reference result requires a registered component.');
        call.result = this.encode(value); call.export = 'completed';
      } catch (error) { call.export = 'failed'; call.error = errorData(error); }
    }
    this.notifyCall(call);
    if (process.stop?.reason === 'error') this.failed(process.stop.error);
  }

  admitCall() {
    if (this.closed) throw new Error('The component runtime is closed.');
    if (this.calls.size >= this.maxCalls) throw new Error(`Component call limit ${this.maxCalls} reached. Release completed calls before starting another.`);
    if ([...this.calls.values()].filter(call => !['completed', 'cancelled'].includes(call.status)).length >= this.maxActive) {
      throw new Error(`Component active call limit ${this.maxActive} reached.`);
    }
  }

  notifyCall(call) {
    call.updatedAt = new Date().toISOString();
    const state = this.describeCall(call);
    this.changed({ type: 'call', ...state });
    for (const resolve of call.waiters) resolve(state);
    call.waiters.clear();
  }

  describeCall(call) {
    return { id: call.id, target: call.target, version: call.version, selector: call.selector, args: call.args,
      parentCall: call.parentCall, processId: call.processId, status: call.status, execution: call.execution,
      export: call.export, result: call.result, error: call.error,
      job: call.job, progress: call.progress, publishing: call.publishing, startedAt: call.startedAt, updatedAt: call.updatedAt,
      retained: call.retained || this.runtime.processes.get(call.processId)?.debuggerRetained === true };
  }

  async completed(id) {
    const call = this.calls.get(id);
    if (!call) throw new Error(`Unknown call: ${id}.`);
    while (!['completed', 'cancelled'].includes(call.status) && !(call.status === 'paused' && call.error)) {
      await new Promise(resolve => call.waiters.add(resolve));
    }
    return this.describeCall(call);
  }

  async send(target, selector, args, { owner, releaseOnSuccess = false } = {}) {
    if (owner?.scope.closed) throw new Error('The component scope is closed.');
    const perform = async () => {
      const request = { op: 'objects.send', target, selector, args: this.encode(args) };
      const state = await (this.local(target) ? this.completed(this.start(request).id) : this.remote(request));
      if (state.error) throw Object.assign(new Error(state.error.message), state.error);
      if (state.status === 'cancelled') throw new Error(`Component call ${state.id} was cancelled.`);
      const result = this.decode(state.result);
      if (releaseOnSuccess) {
        try {
          if (this.local(target)) this.release(state.id, true);
          else await this.remote({ op: 'calls.release', runtime: target.runtime, target, id: state.id, ifSuccessful: true });
        } catch (error) {
          throw Object.assign(error, { message: `Call ${state.id} completed, but releasing it failed: ${error.message}`,
            phase: 'release', callId: state.id, result: state.result });
        }
      }
      return result;
    };
    const pending = perform();
    return owner ? owner.scope.task(pending) : pending;
  }

  release(id, ifSuccessful = false) {
    const call = this.calls.get(id);
    if (ifSuccessful && call && (call.status !== 'completed' || call.error || this.describeCall(call).retained)) return { released: null };
    if (!call || !['completed', 'cancelled'].includes(call.status) || call.execution === 'running') throw new Error('Release requires a completed or cancelled call with no remaining host execution.');
    this.runner.forget(call.processId);
    if (this.runtime.processes.has(call.processId)) this.runtime.dispose(call.processId);
    this.calls.delete(call.id); this.processCalls.delete(call.processId);
    this.changed({ type: 'call-released', id, processId: call.processId });
    return { released: id };
  }

  assertIdle(instance) {
    const calls = this.active(instance);
    const processes = this.activeProcesses(instance);
    if (calls.length || processes.length || instance.scope.tasks.size) throw new Error(`Component is busy: ${calls.length} active calls, ${processes.length} active processes, ${instance.scope.tasks.size} host tasks.`);
  }

  async reconnect({ target, name, expectedRevision, expectedTarget, replacement }) {
    const instance = this.get(target);
    const binding = instance.bindings[name];
    if (!binding) throw new Error(`Unknown component binding: ${name}.`);
    const observers = [...this.observers].filter(observer => observer.owner === instance && observer.name === name);
    if (observers.length && !this.local(replacement)) throw new Error('An observed binding requires a target in this runtime.');
    const check = () => {
      if (instance.status !== 'ready') throw new Error(`Component ${instance.id} is ${instance.status}.`);
      this.assertIdle(instance);
      if (binding.revision !== expectedRevision || referenceKey(binding.target) !== referenceKey(expectedTarget)) throw new Error('Component binding revision conflict.');
    };
    check();
    await this.checkBinding(replacement, instance.module.source.manifest.bindings[name]);
    check();
    binding.target = this.intern(replacement); binding.revision++; instance.revision++;
    this.notify(instance);
    for (const observer of observers) this.scheduleObservation(observer);
    return this.describe(instance);
  }

  async dispose(target) {
    const instance = this.get(target);
    if (instance.workspace) throw new Error('The workspace owns this object. Discard its work through the workspace.');
    if (instance.status === 'disposed') return this.describe(instance);
    this.assertDisposable(instance);
    instance.status = 'disposing'; this.notify(instance);
    try {
      await instance.scope.dispose();
      await instance.object?.dispose?.();
      this.finishDisposal(instance);
      return this.describe(instance);
    } catch (error) {
      instance.status = 'failed'; instance.error = errorData(error); this.notify(instance);
      throw error;
    }
  }

  assertDisposable(instance, group = []) {
    if (!['ready', 'failed'].includes(instance.status)) throw new Error(`Component ${instance.id} is ${instance.status}.`);
    this.assertIdle(instance);
    if (instance.mounted) throw new Error('Discard the mounted pane before disposing its component.');
    const consumers = [...this.instances.values()].filter(other => other !== instance && !group.includes(other) && other.status !== 'disposed'
      && Object.values(other.bindings).some(binding => referenceKey(binding.target) === referenceKey(instance.reference)));
    if (consumers.length) throw new Error(`Component has consumers: ${consumers.map(item => item.id).join(', ')}.`);
  }

  finishDisposal(instance) {
    instance.status = 'disposed'; instance.object = null;
    if (instance.wrapper) instance.wrapper.slots.service = null;
    this.notify(instance);
  }

  async disposeWorkspace(targets, dispose, check = async () => {}) {
    const instances = targets.map(target => this.get(target));
    for (const instance of instances) {
      if (!instance.workspace) throw new Error('Expected a workspace-owned object.');
      this.assertDisposable(instance, instances);
    }
    const statuses = instances.map(instance => instance.status);
    for (const instance of instances) { instance.status = 'disposing'; this.notify(instance); }
    try { await check(); }
    catch (error) {
      instances.forEach((instance, index) => { instance.status = statuses[index]; this.notify(instance); });
      throw error;
    }
    try {
      const result = await dispose();
      for (const instance of instances) { await instance.scope.dispose(); this.finishDisposal(instance); }
      return result;
    } catch (error) {
      for (const instance of instances) { instance.status = 'failed'; instance.error = errorData(error); this.notify(instance); }
      throw error;
    }
  }

  async dispatch(request) {
    switch (request.op) {
      case 'modules.load': return this.describeModule(await this.load(request.version));
      case 'modules.loaded': return [...this.modules.values()].map(record => this.describeModule(record));
      case 'objects.create': return this.create(request);
      case 'objects.list': return [...this.instances.values()].map(instance => this.describe(instance));
      case 'objects.inspect': return this.describe(this.get(request.target));
      case 'objects.source': return this.sourceOf(this.get(request.target));
      case 'objects.snapshot': return this.snapshot(request.target);
      case 'objects.saved': {
        const instance = this.get(request.target);
        if (instance.status !== 'ready' || instance.revision !== request.expectedRevision
            || JSON.stringify(this.sourceOf(instance)) !== JSON.stringify(request.source)) throw new Error('Component changed after its snapshot. Save its current state again.');
        instance.savedSnapshot = request.snapshot; this.notify(instance);
        return this.describe(instance);
      }
      case 'objects.inspector': {
        if (!this.inspectors) throw new Error('Use the workspace inspector for a browser component.');
        return this.inspectors.open(this.get(request.target).wrapper).state();
      }
      case 'inspector': return this.inspectors.dispatch(request);
      case 'state': return { processes: this.debugger.dispatch({ op: 'processes' }), breakpoints: [...this.runtime.breakpoints.keys()] };
      case 'objects.fields': {
        const instance = this.get(request.target);
        return this.debugger.describe(this.host.value(instance.object), { offset: request.offset ?? 0, limit: request.limit ?? 100 });
      }
      case 'objects.send': return this.completed(this.start(request).id);
      case 'jobs.start': return this.start({ ...request, job: { label: String(request.label ?? request.selector).slice(0, 120), input: request.input ?? {} } });
      case 'objects.dispose': return this.dispose(request.target);
      case 'bindings.reconnect': return this.reconnect(request);
      case 'calls.list': return [...this.calls.values()].map(call => this.describeCall(call));
      case 'calls.inspect': {
        const call = this.calls.get(request.id);
        if (!call) throw new Error(`Unknown call: ${request.id}.`);
        call.retained = true;
        return { ...this.describeCall(call), process: this.runtime.processes.has(call.processId) ? this.debugger.inspect(call.processId) : null,
          resultHandle: Object.hasOwn(call, 'rawResult') ? this.debugger.value(this.host.value(call.rawResult)) : null };
      }
      case 'calls.cancel': {
        const call = this.calls.get(request.id);
        if (!call) throw new Error(`Unknown call: ${request.id}.`);
        if (call.publishing && call.execution !== 'failed') throw new Error('The call is publishing its result and cannot be cancelled.');
        this.runtime.cancel(call.processId); this.runner.follow(call.processId);
        return this.describeCall(call);
      }
      case 'calls.retain': {
        const call = this.calls.get(request.id);
        if (!call) throw new Error(`Unknown call: ${request.id}.`);
        call.retained = true; this.notifyCall(call);
        return this.describeCall(call);
      }
      case 'calls.release': return this.release(request.id, request.ifSuccessful);
      case 'debug.smallslop': {
        const call = this.processCalls.get(request.request.processId);
        if (request.request.op === 'cancel' && call?.publishing && call.execution !== 'failed') throw new Error('The call is publishing its result and cannot be cancelled.');
        const result = this.debugger.dispatch(request.request);
        if (['run', 'resume', 'step', 'stepOver', 'stepOut', 'retry', 'cancel', 'pause'].includes(request.request.op)) this.runner.follow(request.request.processId);
        return result;
      }
      default: throw new Error(`Unknown component operation: ${request.op}.`);
    }
  }

  async close() {
    this.closed = true;
    for (const call of this.calls.values()) {
      if (!['completed', 'cancelled'].includes(call.status)) {
        this.runtime.cancel(call.processId);
        this.updateCall(call.processId);
      }
    }
    this.unsubscribe();
    this.inspectors?.dispose();
    const errors = [];
    for (const instance of this.instances.values()) {
      try { await instance.scope.dispose(); if (!instance.workspace) await instance.object?.dispose?.(); }
      catch (error) { errors.push(error); }
    }
    if (this.ownsRuntime) this.runner.close();
    if (errors.length) throw new AggregateError(errors, 'Component runtime cleanup failed.');
  }
}
