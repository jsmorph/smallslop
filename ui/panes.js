import { Debugger, Host, ProcessRunner, Runtime } from '../src/index.js';

const methods = [
  `open visible := true. self render. self focus`,
  `close visible := false. self render`,
  `focus ^view call: 'focus'`,
  `render ^view call: 'render'`,
  `bounds: left top: top width: horizontal height: vertical
    | rectangle |
    rectangle := view call: 'bounds' with: left with: top with: horizontal with: vertical.
    x := rectangle get: 'x'. y := rectangle get: 'y'.
    width := rectangle get: 'width'. height := rectangle get: 'height'.
    self render`,
  `moveTo: left y: top
    self bounds: left top: top width: width height: height.
    enlarged := false. self render`,
  `resizeTo: horizontal height: vertical
    self bounds: x top: y width: horizontal height: vertical.
    enlarged := false. self render`,
  `enlarge
    enlarged ifTrue: [
      enlarged := false.
      self bounds: (savedBounds get: 'x') top: (savedBounds get: 'y')
        width: (savedBounds get: 'width') height: (savedBounds get: 'height')
    ] ifFalse: [
      savedBounds := view call: 'rectangle'. enlarged := true.
      self fit
    ]. self focus`,
  `fit self bounds: 0.0 top: 0.0 width: (view call: 'width') height: (view call: 'height')`,
];

export function paneBounds(rectangle, extent) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(rectangle[key])) throw new Error(`Pane ${key} must be a finite number.`);
  }
  const width = Math.min(Math.max(260, rectangle.width), Math.max(1, extent.width));
  const height = Math.min(Math.max(180, rectangle.height), Math.max(1, extent.height));
  return { x: Math.max(0, Math.min(rectangle.x, extent.width - width)),
    y: Math.max(0, Math.min(rectangle.y, extent.height - height)), width, height };
}

export class PaneWorld {
  constructor({ extent, createView, changed = () => {}, failed = () => {} }) {
    this.runtime = new Runtime();
    this.debugger = new Debugger(this.runtime);
    this.runner = new ProcessRunner(this.runtime, { onChange: id => {
      const process = this.runtime.processes.get(id);
      if (process?.stop?.reason === 'error') failed(process.stop.error);
      changed();
    } });
    this.host = new Host(this.runtime, this.runner);
    this.panes = new Map();
    this.order = [];
    this.extent = extent;
    this.createView = createView;
    this.changed = changed;
    this.focused = null;
    this.klass = this.runtime.defineClass('Pane', { category: 'Workspace',
      slots: ['id', 'title', 'owner', 'x', 'y', 'width', 'height', 'visible', 'enlarged', 'savedBounds', 'view'] });
    for (const source of methods) this.runtime.installSource(this.klass, source, { protocol: 'window controls' });
  }

  register(definition) {
    if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || this.panes.has(definition.id)) throw new Error('A pane requires a unique id.');
    const object = this.runtime.newObject(definition.className ? this.runtime.classes.get(definition.className) : this.klass);
    const rectangle = paneBounds({ x: 24, y: 24, width: 560, height: 480, ...definition.bounds }, this.extent());
    Object.assign(object.slots, { id: definition.id, title: definition.title, owner: definition.owner ?? null,
      ...rectangle, visible: false, enlarged: false });
    const pane = { ...definition, object, scope: this.host.scope(), last: null };
    pane.view = this.createView(pane);
    this.panes.set(pane.id, pane);
    this.order.push(pane.id);
    object.slots.view = this.host.value({
      bounds: (x, y, width, height) => paneBounds({ x, y, width, height }, this.extent()),
      rectangle: () => this.rectangle(pane),
      width: () => this.extent().width,
      height: () => this.extent().height,
      render: () => {
        if (!pane.object.slots.visible && this.focused === pane.id) this.focused = null;
        const ready = pane.view.render(); this.changed();
        return ready;
      },
      focus: () => {
        if (!pane.object.slots.visible) return;
        this.order = this.order.filter(id => id !== pane.id);
        this.order.push(pane.id);
        this.focused = pane.id; pane.view.focus(); this.changed();
      },
    });
    pane.view.render();
    return pane;
  }

  require(id) {
    const pane = this.panes.get(id);
    if (!pane) throw new Error(`Unknown pane: ${id}.`);
    return pane;
  }

  remove(id) {
    const pane = this.require(id);
    const finish = () => {
      this.panes.delete(id);
      this.order = this.order.filter(value => value !== id);
      if (this.focused === id) this.focused = null;
      this.changed();
    };
    const releaseView = () => {
      const ready = pane.view.dispose();
      if (ready && typeof ready.then === 'function') return Promise.resolve(ready).then(finish);
      finish();
    };
    const ready = pane.scope.dispose();
    if (ready && typeof ready.then === 'function') return Promise.resolve(ready).then(releaseView);
    return releaseView();
  }

  rectangle(pane) {
    const { x, y, width, height } = pane.object.slots;
    return { x, y, width, height };
  }

  send(id, selector, args = []) {
    const pane = this.require(id);
    pane.scope.reap();
    const processId = this.runtime.start(pane.object, selector, args, { scope: pane.scope });
    pane.last = processId;
    this.runtime.run(processId, { budget: 1000 });
    this.runner.follow(processId);
    const process = this.runtime.process(processId);
    if (process.stop?.reason === 'error') throw process.stop.error;
    return this.debugger.inspect(processId);
  }

  dispatch(request) {
    switch (request.op) {
      case 'state': return { focused: this.focused, panes: [...this.panes.values()].map(pane => ({
        id: pane.id, title: pane.object.slots.title, description: pane.description,
        ...this.rectangle(pane), visible: pane.object.slots.visible, enlarged: pane.object.slots.enlarged,
        association: pane.association ?? null, owner: this.debugger.value(pane.object.slots.owner),
        object: this.debugger.value(pane.object), processId: pane.last, content: pane.view.state?.() ?? null,
      })) };
      case 'open': case 'close': case 'focus': case 'enlarge': return this.send(request.id, request.op);
      case 'move': return this.send(request.id, 'moveTo:y:', [request.x, request.y]);
      case 'resize': return this.send(request.id, 'resizeTo:height:', [request.width, request.height]);
      case 'send': return this.send(request.id, request.selector, (request.args ?? []).map(value => this.debugger.decode(value)));
      case 'debug': {
        const result = this.debugger.dispatch(request.request);
        const { op, processId } = request.request;
        if (op === 'dispose') this.runner.forget(processId);
        if (['run', 'resume', 'pause', 'step', 'stepOver', 'stepOut', 'retry', 'cancel'].includes(op)) this.runner.follow(processId);
        return result;
      }
      default: throw new Error(`Unknown workspace operation: ${request.op}.`);
    }
  }

  layout() {
    return { version: 1, panes: this.order.map(id => this.require(id)).map(pane => ({ id: pane.id,
      ...this.rectangle(pane), visible: pane.object.slots.visible, enlarged: pane.object.slots.enlarged,
      savedBounds: this.host.unwrap(pane.object.slots.savedBounds),
    })) };
  }

  restore(layout) {
    if (layout?.version !== 1 || !Array.isArray(layout.panes)) throw new Error('Unrecognized workspace layout.');
    const ids = new Set();
    for (const entry of layout.panes) {
      if (!entry || typeof entry.id !== 'string' || ids.has(entry.id)) throw new Error('Invalid or duplicate pane id.');
      ids.add(entry.id);
    }
    const restored = layout.panes.filter(entry => this.panes.has(entry.id)).map(entry => {
      if (typeof entry.visible !== 'boolean' || typeof entry.enlarged !== 'boolean') throw new Error('Invalid pane visibility.');
      const rectangle = paneBounds(entry, this.extent());
      const savedBounds = entry.savedBounds ? paneBounds(entry.savedBounds, this.extent()) : rectangle;
      return { entry, rectangle, savedBounds };
    });
    this.focused = null;
    for (const { entry, rectangle, savedBounds } of restored) {
      const pane = this.require(entry.id);
      Object.assign(pane.object.slots, rectangle, { visible: entry.visible, enlarged: entry.enlarged,
        savedBounds: this.host.value(savedBounds) });
      if (entry.enlarged) this.send(entry.id, 'fit');
      else pane.view.render();
      if (entry.visible) {
        pane.view.focus();
        this.focused = pane.id;
      }
    }
    this.order = [...this.order.filter(id => !restored.some(item => item.entry.id === id)), ...restored.map(item => item.entry.id)];
    this.changed();
  }

  fit() {
    for (const pane of this.panes.values()) {
      if (pane.object.slots.enlarged) this.send(pane.id, 'fit');
      else {
        Object.assign(pane.object.slots, paneBounds(this.rectangle(pane), this.extent()));
        pane.view.render();
      }
    }
    this.changed();
  }

  dispose() {
    this.runner.close();
    for (const pane of this.panes.values()) { pane.scope.dispose(); pane.view.dispose(); }
    this.panes.clear();
    this.debugger.dispatch({ op: 'releaseAll' });
  }
}
