import { Debugger } from './debugger.js';

const methods = [
  `select: name selection := service call: 'field' with: name`,
  `page: start offset := service call: 'offset' with: start. selection := 'self'`,
  `expression: text expression := service call: 'text' with: text`,
  `evaluate: mode process := service call: 'evaluate' with: expression with: mode`,
];
const controls = ['run', 'resume', 'pause', 'step', 'stepOver', 'stepOut', 'retry', 'cancel'];
const selectors = { select: 'select:', page: 'page:', expression: 'expression:', evaluate: 'evaluate:' };

export class Inspectors {
  constructor(host, debugger_) {
    this.host = host;
    this.debugger = debugger_;
    this.sessions = new Map();
    this.id = crypto.randomUUID();
    this.nextId = 1;
    const runtime = host.runtime;
    const klass = runtime.defineClass('Inspector', { category: 'Tools-Inspector',
      slots: ['subject', 'selection', 'offset', 'expression', 'process', 'service'] });
    for (const source of methods) runtime.installSource(klass, source, { protocol: 'inspecting' });
    this.klass = klass;
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown inspector: ${id}.`);
    return session;
  }

  open(value) {
    const id = `${this.id}:i${this.nextId++}`;
    const session = new Inspection(this, id, value);
    this.sessions.set(id, session);
    return session;
  }

  close(id, processId) {
    const session = this.get(id);
    if (processId !== undefined) {
      const count = session.pinned.get(processId);
      if (!count) throw new Error(`Process ${processId} is not retained by this inspector.`);
      if (count === 1) session.pinned.delete(processId); else session.pinned.set(processId, count - 1);
    }
    if (--session.references === 0) {
      session.dispose();
      this.sessions.delete(id);
    }
    return { closed: id };
  }

  dispatch(request) {
    const { action, id } = request;
    if (action === 'open') {
      const source = request.from ? this.get(request.from).debugger : this.debugger;
      return this.open(source.decode(request.value ?? { kind: 'nil' })).state();
    }
    const session = this.get(id);
    if (action === 'close') return this.close(id, request.processId);
    if (action === 'retain') {
      if (request.processId !== undefined) {
        if (!session.scope.processes.has(request.processId) && !session.commands.processes.has(request.processId)) throw new Error('The process belongs to another inspector.');
        session.pinned.set(request.processId, (session.pinned.get(request.processId) ?? 0) + 1);
      }
      session.references++;
      return { retained: id };
    }
    if (action === 'openSelected' || action === 'openResult') {
      return this.open(action === 'openSelected' ? session.selected() : session.result()).state();
    }
    if (action === 'openClass') return this.open(this.host.runtime.classOf(session.slots.subject)).state();
    if (action === 'state') return session.state();
    if (action === 'debug') {
      const result = session.debugger.dispatch(request.request);
      if (controls.includes(request.request.op)) this.host.runner.follow(request.request.processId);
      return result;
    }
    session.command(action, request.value);
    return session.state();
  }

  dispose() {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }
}

class Inspection {
  constructor(owner, id, subject) {
    this.owner = owner;
    this.id = id;
    this.references = 1;
    this.pinned = new Map();
    this.debugger = new Debugger(owner.host.runtime);
    this.scope = owner.host.scope();
    this.commands = owner.host.scope();
    this.object = this.runtime.newObject(owner.klass);
    Object.assign(this.object.slots, { subject, selection: 'self', offset: 0,
      expression: 'self', process: null, service: owner.host.value(this) });
    this.commandId = null;
    this.closed = false;
  }

  get runtime() { return this.owner.host.runtime; }
  get slots() { return this.object.slots; }

  description() { return this.debugger.describe(this.slots.subject, { offset: this.slots.offset, limit: 100 }); }

  fields(description = this.description()) {
    const fields = [{ key: 'self', name: 'self', value: this.debugger.value(this.slots.subject) }];
    if (description.slots && !Array.isArray(description.slots)) {
      fields.push(...Object.entries(description.slots).map(([name, value]) => ({ key: `slot:${name}`, name, value })));
    } else if (description.properties) fields.push(...description.properties.map(field => ({ ...field, key: `property:${field.name}` })));
    else if (description.items) fields.push(...description.items.map((value, index) => ({ key: `index:${description.offset + index}`, name: String(description.offset + index), value })));
    else if (description.superclass) fields.push({ key: 'superclass', name: 'superclass', value: description.superclass });
    if (description.receiver) fields.push({ key: 'receiver', name: 'receiver', value: description.receiver });
    for (const [depth, scope] of (description.scopes ?? []).entries()) {
      fields.push(...Object.entries(scope).map(([name, value]) => ({ key: `scope:${depth}:${name}`, name: `scope ${depth}: ${name}`, value })));
    }
    return fields;
  }

  field(name) {
    if (!this.fields().some(field => field.key === name)) throw new Error(`Unknown inspector field: ${name}.`);
    return name;
  }

  offset(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('The inspector offset must be a nonnegative integer.');
    const description = this.description();
    const total = description.total ?? description.length ?? 0;
    if (value >= total && value !== 0) throw new Error('The inspector offset exceeds the collection size.');
    return value;
  }

  text(value) {
    if (typeof value !== 'string') throw new Error('Expected an expression string.');
    return value;
  }

  selected() {
    const field = this.fields().find(field => field.key === this.slots.selection);
    if (!field?.value) throw new Error('Select a stored value. Evaluate an accessor through an explicit message.');
    return this.debugger.decode(field.value);
  }

  result() {
    const process = this.runtime.process(this.slots.process);
    if (process.status !== 'completed') throw new Error('The evaluation has not completed.');
    return process.result;
  }

  evaluate(source, mode) {
    if (!['run', 'debug'].includes(mode)) throw new Error('Choose run or debug.');
    const previous = this.runtime.processes.get(this.slots.process);
    if (previous && !['completed', 'cancelled'].includes(previous.status)) throw new Error('Complete or cancel the current evaluation before starting another.');
    const id = this.runtime.evaluate(source, { receiver: this.slots.subject, scope: this.scope });
    this.slots.process = id;
    this.scope.reap({ keep: id, retain: this.pinned });
    if (mode === 'debug') this.runtime.pause(id);
    else this.runtime.run(id, { budget: 1000 });
    this.owner.host.runner.follow(id);
    return id;
  }

  command(action, value) {
    if (this.closed) throw new Error('The inspector is closed.');
    if (controls.includes(action)) {
      if (this.slots.process === null) throw new Error('Evaluate an expression first.');
      this.debugger.dispatch({ op: action, processId: this.slots.process });
      this.owner.host.runner.follow(this.slots.process);
      return;
    }
    if (!Object.hasOwn(selectors, action)) throw new Error(`Unknown inspector action: ${action}.`);
    const selector = selectors[action];
    const id = this.runtime.start(this.object, selector, [value], { scope: this.commands });
    this.commandId = id;
    this.runtime.run(id, { budget: 1000 });
    this.commands.reap({ keep: id, retain: this.pinned });
    this.owner.host.runner.follow(id);
  }

  state() {
    const description = this.description();
    const fields = this.fields(description);
    return {
      id: this.id, model: this.debugger.value(this.object), subject: this.debugger.value(this.slots.subject),
      className: description.className, description, fields, selection: this.slots.selection,
      selected: fields.find(field => field.key === this.slots.selection) ?? null,
      expression: this.slots.expression, offset: this.slots.offset,
      total: description.total ?? description.length ?? null,
      process: this.slots.process === null ? null : this.debugger.inspect(this.slots.process),
      command: this.commandId === null ? null : this.debugger.inspect(this.commandId),
    };
  }

  dispose() {
    this.closed = true;
    this.commands.dispose();
    this.scope.dispose();
    this.debugger.releaseAll();
  }
}
