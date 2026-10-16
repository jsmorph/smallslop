import { Block, Debugger, Host, HostOperation, ProcessRunner, Runtime } from '../src/index.js';
import { fetchSources } from '../ui/sources.js';

export const methods = [
  `initialize: element service: hostService
  | step |
  root := element. service := hostService. count := 0. step := 1.
  output := root call: 'querySelector' with: '.count'.
  (root call: 'querySelector' with: '[data-action="increment"]')
    on: 'click' do: [:event | self increment: step].
  (root call: 'querySelector' with: '[data-action="repair"]')
    on: 'click' do: [self repair].
  (root call: 'querySelector' with: '[data-action="loop"]')
    on: 'click' do: [self countMany].
  (root call: 'querySelector' with: '[data-action="delay"]')
    on: 'click' do: [self delayed: false].
  (root call: 'querySelector' with: '[data-action="reject"]')
    on: 'click' do: [self delayed: true].
  self render`,
  `increment: amount
  count := count + amount.
  self render.
  ^count`,
  `render
  output set: 'textContent' to: count asString`,
  `repair
  count := count + 1.
  output set: 'textContent' to: self missingText`,
  `countMany
  | remaining |
  remaining := 10000.
  [remaining > 0] whileTrue: [count := count + 1. remaining := remaining - 1].
  self render`,
  `delayed: fail
  | amount |
  amount := service call: 'incrementAfter' with: 350.0 with: fail.
  ^self increment: amount`,
];

const { kernel } = await fetchSources(['kernel']);
const runtime = new Runtime({ sources: kernel });
const agent = new Debugger(runtime);
const view = new Debugger(runtime);
const widgets = new Map();
const points = new Map();
const runner = new ProcessRunner(runtime, { budget: 500, onChange: changed });
const host = new Host(runtime, runner);
const klass = runtime.defineClass('Counter', { slots: ['root', 'output', 'service', 'count'] });
for (const source of methods) runtime.installSource(klass, source);
let nextWidget = 1;
let selectedProcess = null;
let selectedFrame = null;
let inspected = null;
let editorMethod = null;
const stats = { calls: 0, cancellations: 0 };
const byId = id => document.getElementById(id);
const encode = value => JSON.stringify(value);
const clone = value => JSON.parse(encode(value));

function notice(message, error = false) {
  byId('notice').textContent = message;
  byId('notice').dataset.error = String(error);
}

function perform(action) {
  notice('');
  try { action(); } catch (error) { notice(error.stack ?? String(error), true); }
}

function ownerOf(id) {
  const scope = runtime.processes.get(id)?.scope;
  return [...widgets.values()].find(widget => widget.scope === scope);
}

function changed(id) {
  const process = runtime.processes.get(id);
  const widget = ownerOf(id);
  if (widget && process) {
    widget.last = id;
    if (process.stop?.reason === 'start' && process.frame.receiver instanceof Block && widget.pause.checked) {
      widget.pause.checked = false;
      runtime.pause(id);
      runner.forget(id);
      selectedProcess = id;
      selectedFrame = null;
    }
    const selected = runtime.processes.get(selectedProcess);
    if (!selected || ['completed', 'cancelled'].includes(selected.status)) {
      selectedProcess = id;
      selectedFrame = null;
    }
    widget.scope.reap({ keep: selectedProcess !== null && widget.scope.processes.has(selectedProcess) ? selectedProcess : id });
  }
  renderLists();
  if (id === selectedProcess || !runtime.processes.has(selectedProcess)) {
    selectedFrame = null;
    renderInspector();
  }
}

function dispatch(request, debugger_ = agent) {
  const input = clone(request);
  const result = clone(debugger_.dispatch(input));
  if (input.op === 'breakpoint') points.set(result.id, { methodId: input.methodId, pc: input.pc ?? 0, path: input.path ?? [] });
  if (input.op === 'clearBreakpoint') points.delete(input.id);
  if (input.op === 'dispose') runner.forget(input.processId);
  if (['run', 'resume', 'pause', 'step', 'stepOver', 'stepOut', 'retry', 'cancel'].includes(input.op)) runner.follow(input.processId);
  if (input.op === 'install') refreshMethods(result.selector);
  if (input.op === 'evaluate') {
    selectedProcess = result.id;
    selectedFrame = null;
  }
  renderLists();
  if (input.processId === selectedProcess || input.op === 'evaluate' || input.op === 'dispose') renderInspector();
  return result;
}

function service() {
  return host.value({
    incrementAfter(milliseconds, fail) {
      if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Delay requires a nonnegative Float.');
      if (typeof fail !== 'boolean') throw new Error('Failure selection requires a Boolean.');
      stats.calls++;
      const { promise, resolve, reject } = Promise.withResolvers();
      const timer = setTimeout(() => fail ? reject(new Error('Requested asynchronous failure')) : resolve(1n), milliseconds);
      return new HostOperation(promise, { cancel() {
        stats.cancellations++;
        clearTimeout(timer);
        reject(new DOMException('Cancelled by the debugger', 'AbortError'));
      } });
    },
  });
}

function addCounter() {
  const id = nextWidget++;
  const root = document.createElement('article');
  root.className = 'counter';
  root.dataset.counter = String(id);
  root.innerHTML = `<header><h2>Counter ${id}</h2><button data-action="remove" type="button">Remove</button></header>
    <output class="count" aria-label="Count">0</output>
    <div class="row"><button data-action="increment" type="button">Increment</button><button data-action="repair" type="button">Missing method</button><button data-action="loop" type="button">Count 10,000</button></div>
    <div class="row"><button data-action="delay" type="button">Increment later</button><button data-action="reject" type="button">Reject later</button></div>
    <div class="row"><label><input type="checkbox" data-action="pause-next"> Pause next event</label><button data-action="inspect" type="button">Inspect process</button></div>
    <p class="status" aria-live="polite">Initializing</p>`;
  byId('counters').append(root);
  const scope = host.scope();
  const object = runtime.newObject(klass);
  const controls = new AbortController();
  const widget = { id, root, scope, object, controls, last: null, pause: root.querySelector('[data-action="pause-next"]') };
  widgets.set(id, widget);
  root.querySelector('[data-action="remove"]').addEventListener('click', () => perform(() => removeCounter(id)), { signal: controls.signal });
  root.querySelector('[data-action="inspect"]').addEventListener('click', () => {
    selectedProcess = widget.last;
    selectedFrame = null;
    renderLists();
    renderInspector();
  }, { signal: controls.signal });
  scope.start(object, 'initialize:service:', [host.value(root), service()]);
  return id;
}

function removeCounter(id) {
  const widget = widgets.get(id);
  if (!widget) throw new Error(`Unknown counter: ${id}.`);
  widget.scope.dispose();
  widget.controls.abort();
  widgets.delete(id);
  widget.root.remove();
  if (!runtime.processes.has(selectedProcess)) {
    selectedProcess = runtime.processes.keys().next().value ?? null;
    selectedFrame = null;
  }
  view.release([...view.objects.keys()]);
  renderLists();
  renderInspector();
}

function renderLists() {
  const select = byId('process');
  select.replaceChildren();
  for (const process of runtime.processes.values()) {
    const owner = ownerOf(process.id);
    const option = document.createElement('option');
    option.value = String(process.id);
    option.textContent = `${owner ? `Counter ${owner.id}` : 'Evaluation'} / ${process.id}: ${process.status}, ${process.stop?.reason ?? 'running'}`;
    select.append(option);
  }
  select.value = String(selectedProcess);
  for (const widget of widgets.values()) {
    const process = runtime.processes.get(widget.last);
    widget.root.querySelector('.status').textContent = process ? `Process ${process.id}: ${process.status}, ${process.stop?.reason ?? 'running'}` : 'Ready';
    const active = [...widget.scope.processes].some(id => !['completed', 'cancelled'].includes(runtime.process(id).status));
    for (const button of widget.root.querySelectorAll('[data-action="increment"], [data-action="repair"], [data-action="loop"], [data-action="delay"], [data-action="reject"]')) button.disabled = active;
  }
  byId('resources').textContent = `${widgets.size} counters · ${runtime.processes.size} processes · ${[...widgets.values()].reduce((sum, widget) => sum + widget.scope.listeners.size, 0)} listeners · ${agent.objects.size} agent handles`;
  const list = byId('breakpoints');
  list.replaceChildren();
  for (const [id, point] of points) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = `#${id}: method ${point.methodId}, block ${encode(point.path)}, PC ${point.pc}`;
    const button = document.createElement('button');
    button.textContent = 'Remove';
    button.addEventListener('click', () => perform(() => dispatch({ op: 'clearBreakpoint', id }, view)));
    row.append(label, button);
    list.append(row);
  }
}

function editable(container, label, value, request, disabled) {
  const row = document.createElement('label');
  row.className = 'binding';
  const title = document.createElement('span');
  title.textContent = label;
  const input = document.createElement('input');
  input.value = encode(value);
  input.setAttribute('aria-label', label);
  input.disabled = disabled;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Set';
  button.disabled = disabled;
  button.addEventListener('click', () => perform(() => dispatch({ ...request, value: JSON.parse(input.value) }, view)));
  row.append(title, input, button);
  container.append(row);
}

function renderInspector() {
  view.release([...view.objects.keys()]);
  inspected = runtime.processes.has(selectedProcess) ? view.dispatch({ op: 'inspect', processId: selectedProcess }) : null;
  const state = inspected;
  byId('process-status').textContent = state ? `${state.status}: ${state.stop?.error?.message ?? state.stop?.reason ?? ''}${state.action ? ` / ${state.action.kind} to frame ${state.action.frameId}` : ''}${state.status === 'completed' ? ` / result ${encode(state.result)}` : ''}` : 'Select a process.';
  const frameList = byId('frames');
  frameList.replaceChildren();
  for (const frame of state?.frames ?? []) {
    const option = document.createElement('option');
    option.value = String(frame.id);
    option.textContent = `${frame.className}>>${frame.selector} / method ${frame.methodId} / block ${encode(frame.codePath)} / PC ${frame.pc}`;
    frameList.append(option);
  }
  if (!state?.frames.some(frame => frame.id === selectedFrame)) selectedFrame = state?.frames[0]?.id ?? null;
  frameList.value = String(selectedFrame);
  const frame = state?.frames.find(frame => frame.id === selectedFrame);
  const paused = state?.status === 'paused';
  const failed = state?.stop?.reason === 'error';
  for (const button of byId('controls').querySelectorAll('button')) {
    button.disabled = button.dataset.op === 'cancel' ? !['paused', 'waiting'].includes(state?.status)
      : button.dataset.op === 'retry' ? !failed : !paused || failed;
  }
  for (const id of ['break-here', 'edit-frame', 'inspect-receiver']) byId(id).disabled = !frame;
  byId('edit-frame').disabled = !frame || frame.className !== 'Counter' || frame.selector === '<entry>';
  byId('evaluate').disabled = !paused || !frame;
  const source = byId('source');
  source.replaceChildren();
  if (frame?.position) {
    const { start, end } = frame.position;
    const mark = document.createElement('mark');
    mark.textContent = frame.source.slice(start, end);
    source.append(document.createTextNode(frame.source.slice(0, start)), mark, document.createTextNode(frame.source.slice(end)));
  } else source.textContent = frame?.source || (frame ? 'Entry bytecode: step into its call to inspect the method or block.' : '');
  byId('stack').textContent = encode(frame?.stack ?? []);
  byId('object').textContent = '';
  const bindings = byId('bindings');
  bindings.replaceChildren();
  frame?.scopes.forEach((scope, depth) => {
    for (const [name, value] of Object.entries(scope)) editable(bindings, `${depth}: ${name}`, value, { op: 'setVariable', processId: selectedProcess, frameId: frame.id, depth, name }, !paused);
  });
  const pending = byId('pending');
  pending.replaceChildren();
  if (frame?.pendingSend) {
    const title = document.createElement('p');
    title.textContent = frame.pendingSend.selector;
    pending.append(title);
    [frame.pendingSend.receiver, ...frame.pendingSend.arguments].forEach((value, index) =>
      editable(pending, index ? `Argument ${index}` : 'Receiver', value, { op: 'setSendOperand', processId: selectedProcess, frameId: frame.id, index }, !paused || (index === 0 && frame.pendingSend.super)));
  }
}

function refreshMethods(selected = byId('method').value) {
  const select = byId('method');
  select.replaceChildren();
  for (const method of klass.methods.values()) {
    const option = document.createElement('option');
    option.value = method.selector;
    option.textContent = method.selector;
    select.append(option);
  }
  select.value = klass.methods.has(selected) ? selected : 'increment:';
}

function loadMethod(id) {
  const method = view.dispatch({ op: 'method', id });
  view.releaseMethods([...view.retainedMethods.keys()]);
  view.retainMethod(id);
  editorMethod = method.id;
  byId('method-source').value = method.codes[0]?.source ?? '';
  byId('method-version').textContent = `${method.className}>>${method.selector}, version ${method.id}`;
  byId('method').value = method.selector;
}

byId('add-counter').addEventListener('click', () => perform(addCounter));
byId('process').addEventListener('change', event => { selectedProcess = Number(event.target.value); selectedFrame = null; renderInspector(); });
byId('frames').addEventListener('change', event => { selectedFrame = Number(event.target.value); renderInspector(); });
for (const button of byId('controls').querySelectorAll('button')) button.addEventListener('click', () => perform(() => dispatch({ op: button.dataset.op, processId: selectedProcess, budget: runner.budget }, view)));
byId('break-here').addEventListener('click', () => perform(() => {
  const frame = inspected.frames.find(value => value.id === selectedFrame);
  dispatch({ op: 'breakpoint', methodId: frame.methodId, path: frame.codePath, pc: frame.pc }, view);
}));
byId('edit-frame').addEventListener('click', () => perform(() => loadMethod(inspected.frames.find(frame => frame.id === selectedFrame).methodId)));
byId('inspect-receiver').addEventListener('click', () => perform(() => {
  const receiver = inspected.frames.find(frame => frame.id === selectedFrame).receiver;
  byId('object').textContent = receiver.kind === 'object' ? JSON.stringify(view.dispatch({ op: 'object', id: receiver.id }), null, 2) : encode(receiver);
  byId('object').parentElement.open = true;
}));
byId('evaluate').addEventListener('click', () => perform(() => {
  const state = dispatch({ op: 'evaluate', source: byId('expression').value, processId: selectedProcess, frameId: selectedFrame }, view);
  dispatch({ op: 'run', processId: state.id, budget: runner.budget }, view);
}));
byId('method').addEventListener('change', () => perform(() => loadMethod(klass.methods.get(byId('method').value).id)));
byId('new-method').addEventListener('click', () => { view.releaseMethods([...view.retainedMethods.keys()]); editorMethod = null; byId('method-source').value = 'missingText ^count asString'; byId('method-version').textContent = 'New method in Counter'; });
byId('install').addEventListener('click', () => perform(() => {
  const method = dispatch({ op: 'install', className: 'Counter', source: byId('method-source').value }, view);
  loadMethod(method.id);
  notice(`Installed ${method.selector}, version ${method.id}.`);
}));
byId('break-method').addEventListener('click', () => perform(() => {
  if (editorMethod === null) throw new Error('Install the method before setting a breakpoint.');
  dispatch({ op: 'breakpoint', methodId: editorMethod }, view);
}));
byId('send-command').addEventListener('click', () => perform(() => {
  byId('command-result').textContent = JSON.stringify(dispatch(JSON.parse(byId('command').value)), null, 2);
}));

globalThis.smallslop = { Runtime, Debugger, runtime, runner, host, widgets, agent, view, dispatch, addCounter, removeCounter, stats };
refreshMethods('increment:');
loadMethod(klass.methods.get('increment:').id);
addCounter();
addCounter();
if (new URL(location.href).searchParams.has('test')) await import('./counters-test.js');
