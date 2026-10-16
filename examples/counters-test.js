const app = globalThis.smallslop;
const report = document.createElement('pre');
report.id = 'browser-test-report';
document.body.prepend(report);
const failures = [];
addEventListener('error', event => failures.push(event.message));
addEventListener('unhandledrejection', event => failures.push(String(event.reason)));
const checks = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const element = selector => {
  const result = document.querySelector(selector);
  assert(result, `Missing element: ${selector}`);
  return result;
};
const click = selector => {
  const target = element(selector);
  assert(!target.disabled, `Disabled control: ${selector}`);
  target.click();
  assert(document.getElementById('notice').dataset.error !== 'true', document.getElementById('notice').textContent);
};
const choose = (selector, value) => {
  const target = element(selector);
  target.value = String(value);
  target.dispatchEvent(new Event('change', { bubbles: true }));
};
const button = (widget, action) => `[data-counter="${widget.id}"] [data-action="${action}"]`;
const state = widget => app.runtime.inspect(widget.last);
const count = widget => widget.root.querySelector('.count').textContent;
const selected = () => Number(element('#process').value);
const command = op => click(`#controls [data-op="${op}"]`);
const send = request => JSON.parse(JSON.stringify(app.dispatch(JSON.parse(JSON.stringify(request)))));
async function until(predicate, message) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    assert(failures.length === 0, failures.join('\n'));
    await wait(1);
  }
}
function install(source) {
  element('#method-source').value = source;
  click('#install');
}
function edit(selector, value) {
  const input = element(selector);
  input.value = JSON.stringify(value);
  input.parentElement.querySelector('button').click();
  assert(document.getElementById('notice').dataset.error !== 'true', document.getElementById('notice').textContent);
}
function passed(message) { checks.push(message); report.textContent = checks.join('\n'); }

try {
  const [a, b] = [...app.widgets.values()];
  await until(() => state(a).status === 'completed' && state(b).status === 'completed', 'counter initialization');
  assert(count(a) === '0' && count(b) === '0', 'Initial counts');
  click(button(a, 'increment'));
  await until(() => state(a).status === 'completed', 'first increment');
  assert(count(a) === '1' && count(b) === '0', 'Independent counter state');
  passed('DOM callbacks update independent Smallslop objects.');

  click(button(a, 'pause-next'));
  click(button(a, 'increment'));
  const pausedId = a.last;
  assert(state(a).stop.reason === 'pause', 'Pause next event');
  while (!state(a).frames[0].codePath.length) command('step');
  edit('#bindings input[aria-label="1: step"]', { kind: 'integer', value: '7' });
  element('#expression').value = 'step';
  click('#evaluate');
  assert(state(a).result === 7n, 'Frame evaluation shares captured bindings');
  choose('#process', pausedId);
  command('step');
  click(button(b, 'increment'));
  await until(() => state(b).status === 'completed', 'other counter while paused');
  assert(count(b) === '1' && count(a) === '1', 'Other process remains available');
  assert(selected() === pausedId, 'Debugger selection remains on paused process');
  while (state(a).frames[0].pendingSend?.selector !== 'increment:') command('step');
  const callback = state(a).frames[0].id;
  app.runner.budget = 1;
  command('stepOver');
  await until(() => state(a).stop.reason === 'step', 'step over across budgets');
  assert(state(a).frames[0].id === callback && count(a) === '8', 'Step-over target and edited capture');
  app.runner.budget = 500;
  command('resume');
  await until(() => state(a).status === 'completed', 'callback completion');
  passed('Paused capture edits, independent execution, and budgeted step over work through page controls.');

  choose('#method', 'increment:');
  const oldVersion = app.runtime.classes.get('Counter').methods.get('increment:').id;
  click('#break-method');
  click(button(a, 'increment'));
  await until(() => state(a).stop.reason === 'breakpoint', 'method breakpoint');
  assert(state(a).frames[0].methodId === oldVersion, 'Paused old method version');
  install('increment: amount count := count + (amount * 2). self render. ^count');
  assert(state(a).frames[0].methodId === oldVersion, 'Replacement preserves active method');
  click('#breakpoints button');
  command('stepOut');
  await until(() => state(a).stop.reason === 'step', 'step out');
  assert(count(a) === '15', 'Active invocation uses old method');
  command('resume');
  await until(() => state(a).status === 'completed', 'old callback returns');
  click(button(b, 'increment'));
  await until(() => state(b).status === 'completed', 'replacement invocation');
  assert(count(b) === '3', 'New invocation uses replacement');
  install('increment: amount count := count + amount. self render. ^count');
  passed('Method editing preserves active versions and updates later sends.');

  click(button(a, 'repair'));
  await until(() => state(a).stop.reason === 'error', 'missing rendering method');
  const failed = send({ op: 'inspect', processId: a.last });
  assert(failed.stop.error.selector === 'missingText', 'Missing send remains inspectable');
  assert(a.object.slots.count === 16n && count(a) === '15', 'One increment precedes failure');
  click('#new-method');
  click('#install');
  send({ op: 'retry', processId: a.last });
  await until(() => state(a).status === 'completed', 'repaired rendering');
  assert(a.object.slots.count === 16n && count(a) === '16', 'Retry preserves earlier effects');
  element('#command').value = JSON.stringify({ op: 'processes' });
  click('#send-command');
  assert(JSON.parse(element('#command-result').textContent).length === app.runtime.processes.size, 'JSON command control');
  passed('Serialized debugger repair completes the original send without replay.');

  click(button(a, 'delay'));
  await until(() => state(a).status === 'waiting', 'asynchronous wait');
  assert(count(a) === '16', 'Waiting leaves count unchanged');
  click(button(b, 'increment'));
  await until(() => state(b).status === 'completed', 'input during wait');
  assert(count(b) === '4', 'Other counter works during host wait');
  await until(() => state(a).status === 'completed', 'asynchronous success');
  assert(count(a) === '17', 'Host result resumes the call');
  click(button(a, 'reject'));
  await until(() => state(a).stop.reason === 'error', 'asynchronous rejection');
  choose('#process', a.last);
  edit('#pending input[aria-label="Argument 3"]', { kind: 'boolean', value: false });
  command('retry');
  await until(() => state(a).status === 'completed', 'retry asynchronous call');
  assert(count(a) === '18', 'Changed host argument repairs rejection');
  click(button(a, 'delay'));
  await until(() => state(a).status === 'waiting', 'cancellable wait');
  choose('#process', a.last);
  const aborts = app.stats.cancellations;
  command('cancel');
  await wait(400);
  assert(state(a).status === 'cancelled' && count(a) === '18', 'Cancellation prevents resumption');
  assert(app.stats.cancellations === aborts + 1, 'Cancellation reaches the host');
  assert(send({ op: 'object', id: failed.frames[0].receiver.id }).slots.count.value === '18', 'UI updates preserve agent object handles');
  passed('Host waiting, rejection repair, and cancellation work through the debugger.');

  click(button(a, 'loop'));
  await until(() => state(a).stop.reason === 'budget', 'loop yields');
  click(button(b, 'increment'));
  await until(() => state(b).status === 'completed', 'input during loop');
  assert(count(b) === '5', 'Input remains responsive during interpreter loop');
  choose('#process', a.last);
  command('pause');
  const stored = a.object.slots.count;
  await wait(15);
  assert(a.object.slots.count === stored, 'Pause removes automatic execution');
  command('cancel');
  passed('Long computation yields to page input and supports pause and cancellation.');

  const exact = send({ op: 'evaluate', source: '9007199254740993 + 2' });
  const exactResult = send({ op: 'run', processId: exact.id });
  assert(exactResult.result.value === '9007199254740995', 'JSON exact integer result');
  send({ op: 'dispose', processId: exact.id });
  send({ op: 'releaseAll' });
  const baseline = app.runtime.processes.size;
  for (let i = 0; i < 20; i++) {
    click('#add-counter');
    const widget = [...app.widgets.values()].at(-1);
    await until(() => state(widget).status === 'completed', 'created counter');
    const target = widget.root.querySelector('[data-action="increment"]');
    click(button(widget, 'remove'));
    target.click();
    assert(widget.scope.listeners.size === 0 && widget.scope.processes.size === 0, 'Disposed ownership');
    assert(app.runtime.processes.size === baseline, 'Process count stays bounded across disposal');
  }
  for (const widget of [...app.widgets.values()]) click(button(widget, 'remove'));
  assert(app.runtime.processes.size === 0 && app.runner.active.size === 0 && app.runner.queue.size === 0, 'All widget processes released');
  assert(app.view.objects.size === 0 && app.agent.objects.size === 0, 'Debugger handles released');
  assert(failures.length === 0, failures.join('\n'));
  passed('Twenty create/remove cycles release listeners, processes, and debugger handles.');
  report.dataset.result = 'passed';
} catch (error) {
  report.textContent = `${checks.join('\n')}\n${error.stack ?? error}`;
  report.dataset.result = 'failed';
}
