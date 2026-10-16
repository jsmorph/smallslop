import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Debugger, Host, HostOperation, ProcessRunner, Runtime } from '../src/index.js';
import { readPackageSync } from '../server/source-files.mjs';

const kernel = readPackageSync('kernel');

const setup = options => {
  const runtime = new Runtime({ sources: kernel });
  const runner = new ProcessRunner(runtime, options);
  return { runtime, runner, host: new Host(runtime, runner) };
};

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for a process.');
    await delay(1);
  }
}

test('host access preserves identities, receivers, numeric types, and failures', () => {
  const { runtime, runner, host } = setup();
  const object = { count: 3n, child: {}, add(value) { this.count += value; return this; } };
  const receiver = host.value(object);
  assert.equal(host.value(object), receiver);
  const send = (selector, args = []) => runtime.run(runtime.start(receiver, selector, args));
  assert.equal(send('call:with:', ['add', 2n]).result, receiver);
  assert.equal(object.count, 5n);
  assert.equal(send('get:', ['child']).result, host.value(object.child));
  assert.equal(send('set:to:', ['count', 9007199254740993n]).result, 9007199254740993n);
  assert.equal(object.count, 9007199254740993n);
  const missing = send('get:', ['missing']).result;
  assert.equal(runtime.run(runtime.start(missing, 'isUndefined')).result, true);
  assert.equal(host.unwrap(missing), undefined);
  assert.equal(host.value(1), 1);
  assert.equal(send('call:with:', ['add', 0.5]).stop.reason, 'error');
  const frozen = host.value(Object.freeze({ value: 1 }));
  assert.match(runtime.run(runtime.start(frozen, 'set:to:', ['value', 2])).stop.error.message, /Cannot set/);
  const fn = host.value(value => value + 1n);
  assert.equal(runtime.run(runtime.start(fn, 'invokeWith:', [2n])).result, 3n);
  runner.close();
});

test('event callbacks queue escaped blocks and scope disposal removes listeners', async () => {
  const { runtime, runner, host } = setup({ budget: 5 });
  const scope = host.scope();
  const target = new EventTarget();
  const klass = runtime.defineClass('Events', { slots: ['total', 'event'] });
  runtime.installSource(klass, `attach: target | amount |
    total := 0. amount := 2.
    target on: 'click' do: [:received | event := received. total := total + amount]`);
  const object = runtime.newObject(klass);
  try {
    const init = scope.start(object, 'attach:', [host.value(target)]);
    await until(() => runtime.process(init).status === 'completed');
    scope.reap();
    const event = new Event('click');
    target.dispatchEvent(event);
    assert.equal(object.slots.total, 0n);
    await until(() => object.slots.total === 2n);
    assert.equal(host.unwrap(object.slots.event), event);
    assert.equal(scope.listeners.size, 1);
    scope.dispose();
    assert.equal(runtime.processes.size, 0);
    assert.equal(scope.listeners.size, 0);
    target.dispatchEvent(new Event('click'));
    await delay(5);
    assert.equal(object.slots.total, 2n);
    assert.equal(runtime.processes.size, 0);
    assert.throws(() => runtime.start(object, 'yourself', [], { scope }), /closed/);
    assert.equal(runtime.processes.size, 0);
  } finally {
    scope.dispose();
    runner.close();
  }
});

test('asynchronous rejection retains the send and retry starts a new call', async () => {
  const { runtime, runner, host } = setup();
  const requests = [];
  const service = host.value({ fetch() { const request = Promise.withResolvers(); requests.push(request); return request.promise; } });
  const klass = runtime.defineClass('AsyncExample', { slots: ['effects', 'service'] });
  runtime.installSource(klass, "fetch effects := effects + 1. ^service call: 'fetch'");
  const object = runtime.newObject(klass);
  Object.assign(object.slots, { effects: 0n, service });
  const id = runtime.start(object, 'fetch');
  let state = runtime.run(id);
  assert.equal(state.status, 'waiting');
  assert.equal(state.frames[0].pendingSend.selector, 'call:');
  const first = runtime.whenReady(id);
  requests[0].reject(new Error('Host request failed'));
  await first;
  assert.equal(runtime.inspect(id).stop.reason, 'ready');
  state = runtime.resume(id);
  assert.equal(state.stop.reason, 'error');
  assert.equal(state.frames[0].pendingSend.receiver, service);
  assert.equal(object.slots.effects, 1n);
  const send = request => JSON.parse(JSON.stringify(new Debugger(runtime).dispatch(request)));
  assert.match(send({ op: 'inspect', processId: id }).stop.error.message, /Host request failed/);
  assert.equal(runtime.retry(id).status, 'waiting');
  assert.equal(requests.length, 2);
  const second = runtime.whenReady(id);
  requests[1].resolve(42n);
  await second;
  assert.equal(runtime.resume(id).result, 42n);
  assert.equal(object.slots.effects, 1n);
  runner.close();
});

test('cancellation aborts supported work and ignores late success or rejection', async () => {
  const { runtime, runner, host } = setup();
  const scope = host.scope();
  const requests = [];
  let aborts = 0;
  const service = host.value({ wait() {
    const request = Promise.withResolvers();
    requests.push(request);
    return new HostOperation(request.promise, { cancel: () => { aborts++; } });
  } });
  try {
    const first = scope.start(service, 'call:', ['wait']);
    await until(() => runtime.process(first).status === 'waiting');
    const ready = runtime.whenReady(first);
    runtime.cancel(first);
    await ready;
    requests[0].resolve(42n);
    await delay(1);
    assert.equal(runtime.process(first).status, 'cancelled');
    assert.equal(runtime.process(first).result, null);
    const second = scope.start(service, 'call:', ['wait']);
    await until(() => runtime.process(second).status === 'waiting');
    scope.dispose();
    requests[1].reject(new Error('Late failure'));
    await delay(1);
    assert.equal(aborts, 2);
    assert.equal(runtime.processes.size, 0);
    assert.equal(runner.active.size, 0);
    assert.equal(runner.waiting.size, 0);
  } finally {
    scope.dispose();
    runner.close();
  }
});

test('a cancelled caller leaves unfinished host work in its scope', async () => {
  const { runtime, runner, host } = setup();
  const scope = host.scope();
  const pending = Promise.withResolvers();
  const service = host.value({ wait: () => pending.promise });
  const id = scope.start(service, 'call:', ['wait']);
  await until(() => runtime.process(id).status === 'waiting');
  runtime.cancel(id);
  assert.equal(scope.tasks.size, 1);
  pending.resolve(42n);
  await until(() => scope.tasks.size === 0);
  assert.equal(runtime.process(id).status, 'cancelled');
  scope.dispose();
  runner.close();
});

test('owned asynchronous cleanup retains failures for a later disposal attempt', async () => {
  const { runner, host } = setup();
  const scope = host.scope();
  let fail = true;
  scope.own(async () => { if (fail) throw new Error('Cleanup failed.'); });
  await assert.rejects(scope.dispose(), error => error instanceof AggregateError && error.errors[0].message === 'Cleanup failed.');
  assert.equal(scope.listeners.size, 1);
  fail = false;
  await scope.dispose();
  assert.equal(scope.listeners.size, 0);
  runner.close();
});

test('task scheduling serves other processes and preserves stepping through a wait', async () => {
  const { runtime, runner, host } = setup({ budget: 2 });
  const scope = host.scope();
  try {
    const loop = runtime.evaluate('[true] whileTrue: []', { scope });
    runner.follow(loop);
    const short = scope.start(42n, 'yourself');
    await until(() => runtime.process(short).status === 'completed');
    assert.equal(runtime.process(loop).status, 'paused');
    assert.equal(runtime.process(loop).stop.reason, 'budget');
    runtime.pause(loop);
    runner.follow(loop);
    const pc = runtime.inspect(loop).frames[0].pc;
    await delay(5);
    assert.equal(runtime.inspect(loop).frames[0].pc, pc);
    assert.equal(runner.active.has(loop), false);

    const request = Promise.withResolvers();
    const service = host.value({ wait: () => request.promise });
    const id = runtime.start(service, 'call:', ['wait'], { scope });
    runtime.step(id);
    runtime.step(id);
    const state = runtime.stepOver(id);
    assert.equal(state.status, 'waiting');
    runner.follow(id);
    request.resolve(7n);
    await until(() => runtime.process(id).status === 'paused');
    assert.equal(runtime.inspect(id).stop.reason, 'step');
    assert.deepEqual(runtime.inspect(id).frames[0].stack, [7n]);
    assert.equal(runtime.run(id).result, 7n);
  } finally {
    scope.dispose();
    runner.close();
  }
});

test('scope disposal reports cancellation failure and releases process ownership', async () => {
  const { runtime, runner, host } = setup();
  const scope = host.scope();
  const request = Promise.withResolvers();
  const failure = new Error('Host cancellation failed');
  const service = host.value({ wait: () => new HostOperation(request.promise, { cancel() { throw failure; } }) });
  const id = scope.start(service, 'call:', ['wait']);
  await until(() => runtime.process(id).status === 'waiting');
  assert.throws(() => scope.dispose(), error => error instanceof AggregateError && error.errors[0] === failure);
  assert.equal(runtime.processes.size, 0);
  assert.equal(scope.processes.size, 0);
  assert.equal(runner.active.size, 0);
  request.reject(new Error('Late cancellation rejection'));
  await delay(1);
  runner.close();
});
