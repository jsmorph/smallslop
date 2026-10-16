import test from 'node:test';
import assert from 'node:assert/strict';
import { Debugger, Host, HostOperation, ProcessRunner, Runtime } from '../src/index.js';
import { readPackageSync } from '../server/source-files.mjs';

const kernel = readPackageSync('kernel');

function setup() {
  const runtime = new Runtime({ sources: kernel });
  const log = runtime.defineClass('Log', { classSlots: ['entries'] });
  runtime.installSource(log.metaclass, 'reset entries := OrderedCollection new');
  runtime.installSource(log.metaclass, 'add: anObject entries add: anObject. ^anObject');
  runtime.installSource(log.metaclass, 'entries ^entries asArray');
  const run = (source, budget = 1_000_000) => {
    runtime.run(runtime.evaluate('Log reset'));
    return runtime.run(runtime.evaluate(source), { budget });
  };
  const value = source => {
    const state = run(source);
    if (state.status !== 'completed') throw state.stop.error ?? new Error(`Process stopped: ${state.stop.reason}.`);
    return state.result;
  };
  const entries = () => runtime.classes.get('Log').slotValues.entries.slots.items;
  return { runtime, run, value, entries };
}

test('on:do: selects handlers by class and exception set, and the handler value answers on:do:', () => {
  const { value } = setup();
  assert.equal(value("[Error signal: 'bad'] on: Error do: [:e | e messageText]"), 'bad');
  assert.equal(value('[ZeroDivide new signal] on: Error do: [:e | e class name]'), 'ZeroDivide');
  assert.equal(value('[[Warning signal] on: ZeroDivide do: [:e | 1]] on: Warning do: [:e | 2]'), 2n);
  assert.equal(value('[3 foo] on: ZeroDivide, MessageNotUnderstood do: [:e | e message selector]').name, 'foo');
  assert.equal(value('[1 / 0] on: Warning, (ZeroDivide, MessageNotUnderstood) do: [:e | e dividend]'), 1n);
  assert.equal(value('[7] on: Error do: [:e | 0]'), 7n);
  assert.equal(value("(Error new messageText: 'text') description"), 'text');
  assert.equal(value('Error new description'), 'Error');
  assert.equal(value('Error new messageText'), null);
  assert.equal(value("(Error new tag: #code; messageText: 'm'; yourself) tag").name, 'code');
  assert.equal(value("(Error new messageText: 'm') tag"), 'm');
  assert.equal(value('(Error new) isResumable'), false);
  assert.equal(value('(Notification new) isResumable'), true);
  assert.equal(value("(Error new messageText: 'oops') printString"), 'Error: oops');
});

test('handlers return, retry, resume, pass, and use outer exactly as ANSI defines', () => {
  const { value } = setup();
  assert.equal(value('[Error signal. 5] on: Error do: [:e | e return: 6]'), 6n);
  assert.equal(value('[Error signal. 5] on: Error do: [:e | e return]'), null);
  assert.equal(value('[(Warning signal: #w) + 1] on: Warning do: [:e | e resume: 4]'), 5n);
  assert.equal(value('[(Notification signal) isNil] on: Notification do: [:e | e resume]'), true);
  assert.equal(value('(Notification signal: #ignored) isNil'), true);
  assert.equal(value('[3 foo + 1] on: MessageNotUnderstood do: [:e | e resume: 7]'), 8n);
  assert.equal(value('[(10 / 0) + 1] on: ZeroDivide do: [:e | e resume: 2]'), 3n);
  assert.equal(value('[(ZeroDivide dividend: 9) + 1] on: ZeroDivide do: [:e | e resume: e dividend]'), 10n);
  assert.equal(value("[[Error signal: 'x'] on: Error do: [:e | e resume: 1]] on: Error do: [:e | e messageText]"), 'The exception is not resumable.');
  assert.equal(value("| count | count := 0. [count := count + 1. count < 3 ifTrue: [Error signal]. count] on: Error do: [:e | e retry]"), 3n);
  assert.equal(value('[Error signal. 1] on: Error do: [:e | e retryUsing: [2]]'), 2n);
  assert.equal(value("[[Error signal: 'inner'] on: Error do: [:e | e pass]] on: Error do: [:e | e messageText , ' outer']"), 'inner outer');
  assert.equal(value('[[(Warning signal) + 1] on: Warning do: [:e | (e outer) + 10]] on: Warning do: [:e | e resume: 5]'), 15n);
  assert.equal(value('[[(Warning signal) + 1] on: Warning do: [:e | e pass]] on: Warning do: [:e | e resume: 5]'), 6n);
  assert.equal(value('[[Warning signal] on: Warning do: [:e | e isNested]] on: Warning do: [:e | 0]'), true);
  assert.equal(value('[[Warning signal] on: Warning do: [:e | e isNested]] on: ZeroDivide do: [:e | 0]'), false);
  assert.equal(value('[[Notification signal] on: Notification do: [:e | e outer]] value'), null);
  assert.equal(value('[[(ZeroDivide new signal) + 1] on: ZeroDivide do: [:e | e resignalAs: Warning new]] on: Warning do: [:e | e resume: 1]'), 2n);
  assert.equal(value("[[Error signal: 'first'] on: ZeroDivide do: [:e | 0]] on: Error do: [:e | e messageText]"), 'first');
});

test('a handler runs in its handler environment, outside the handlers between it and the signal', () => {
  const { value } = setup();
  assert.equal(value("[[1 / 0] on: ZeroDivide do: [:e | Error signal: 'inner']] on: Error do: [:e | e messageText]"), 'inner');
  assert.equal(value("[[[1 / 0] on: ZeroDivide do: [:e | 2 / 0]] on: Error do: [:e | 'middle']] on: ZeroDivide do: [:e | 'outer']"), 'middle');
  assert.equal(value("[[1 / 0] on: ZeroDivide do: [:e | 2 / 0]] on: ZeroDivide do: [:e | 'outer']"), 'outer');
  assert.equal(value('[[Warning signal] on: Warning do: [:e | [Warning signal] on: Warning do: [:inner | inner isNested]]] on: Warning do: [:e | 0]'), true);
});

test('termination blocks run on normal and abnormal termination, innermost first', () => {
  const { runtime, value, entries } = setup();
  assert.equal(value('[Log add: 1] ensure: [Log add: 2]'), 1n);
  assert.deepEqual(entries(), [1n, 2n]);
  assert.equal(value('[Log add: 1] ifCurtailed: [Log add: 2]'), 1n);
  assert.deepEqual(entries(), [1n]);
  assert.equal(value('[[Log add: 1. Error signal. Log add: 2] ensure: [Log add: 3]] on: Error do: [:e | Log add: 4. e return: 5]'), 5n);
  assert.deepEqual(entries(), [1n, 4n, 3n]);
  assert.equal(value('[[[Error signal] ifCurtailed: [Log add: 1]] ensure: [Log add: 2]] on: Error do: [:e | 3]'), 3n);
  assert.deepEqual(entries(), [1n, 2n]);
  assert.equal(value('| count | count := 0. [[count := count + 1. count < 3 ifTrue: [Error signal]. count] ensure: [Log add: count]] on: Error do: [:e | e retry]'), 3n);
  assert.deepEqual(entries(), [1n, 2n, 3n]);
  assert.equal(value('[[(Warning signal: 1) + 1] ensure: [Log add: 1]] on: Warning do: [:e | e resume: 1]'), 2n);
  assert.deepEqual(entries(), [1n]);

  const klass = runtime.defineClass('Leaver');
  runtime.installSource(klass, 'leave [[^1] ensure: [Log add: 2]] ensure: [Log add: 3]. ^4');
  runtime.installSource(klass, 'curtail [^1] ifCurtailed: [Log add: 5]. ^6');
  assert.equal(value('Leaver new leave'), 1n);
  assert.deepEqual(entries(), [2n, 3n]);
  assert.equal(value('Leaver new curtail'), 1n);
  assert.deepEqual(entries(), [5n]);
  assert.equal(value('[[Error signal] ensure: [Log add: 1]] on: Error do: [:e | ^7]'), 7n);
  assert.deepEqual(entries(), [1n]);
});

test('cancelling a process runs its pending termination blocks once', () => {
  const { runtime, run, entries } = setup();
  let state = run('[[Warning signal] ensure: [Log add: 1]] ensure: [Log add: 2]');
  assert.deepEqual([state.status, state.stop.reason], ['paused', 'warning']);
  state = runtime.cancel(state.id);
  assert.equal(state.status, 'cancelled');
  assert.deepEqual(entries(), [1n, 2n]);

  state = run('[[Warning signal] ensure: [Log add: 1. Log foo. Log add: 2]] ensure: [Log add: 3]');
  state = runtime.cancel(state.id);
  assert.deepEqual([state.status, state.stop.reason, state.stop.error.message], ['paused', 'error', 'Log class does not understand foo.']);
  assert.deepEqual(entries(), [1n]);
  state = runtime.cancel(state.id);
  assert.equal(state.status, 'cancelled');
  assert.deepEqual(entries(), [1n, 3n]);

  state = run('[Warning signal] ensure: [Log add: 1]');
  state = runtime.cancel(state.id, { unwind: false });
  assert.equal(state.status, 'cancelled');
  assert.deepEqual(entries(), []);
});

test('Notification answers nil, Warning pauses, and an unhandled Error pauses at the failed instruction', () => {
  const { runtime, run, value } = setup();
  assert.equal(value('Notification signal'), null);
  let state = run("(Warning signal: 'careful') isNil");
  assert.deepEqual([state.status, state.stop.reason, state.stop.message], ['paused', 'warning', 'careful']);
  assert.equal(runtime.classOf(state.stop.exception).name, 'Warning');
  state = runtime.resume(state.id);
  assert.deepEqual([state.status, state.result], ['completed', true]);

  state = run("Object new error: 'broken'");
  assert.deepEqual([state.stop.reason, state.stop.error.name, state.stop.error.message], ['error', 'Error', 'broken']);
  assert.equal(state.frames[0].selector, 'error:');
  assert.equal(state.frames[0].pendingSend.selector, 'signal:');
  assert.equal(runtime.classOf(state.stop.exception).name, 'Error');

  state = run("Error signal: 'explicit'");
  assert.deepEqual([state.frames[0].selector, state.frames[0].pendingSend.selector, state.stop.error.message], ['<entry>', 'signal:', 'explicit']);

  state = run('| divisor | divisor := 0. ^10 / divisor');
  assert.deepEqual([state.stop.error.name, state.stop.error.message], ['ZeroDivide', 'Division by zero.']);
  assert.equal(state.frames.length, 1);
  assert.equal(state.frames[0].pendingSend.selector, '/');
  runtime.setVariable(state.id, state.frames[0].id, 'divisor', 5n);
  runtime.setSendOperand(state.id, state.frames[0].id, 1, 5n);
  assert.equal(runtime.retry(state.id).result, 2n);

  state = run('3 frobnicate: 4');
  assert.deepEqual([state.stop.error.name, state.stop.error.selector, state.stop.error.arguments, state.stop.error.receiver],
    ['MessageNotUnderstood', 'frobnicate:', [4n], 3n]);
  assert.equal(state.frames.length, 1);
  runtime.installSource(runtime.classes.get('Integer'), 'frobnicate: n ^self * n');
  assert.equal(runtime.retry(state.id).result, 12n);

  state = run('Missing new');
  assert.deepEqual([state.stop.error.name, state.stop.error.variable, state.frames.length], ['UndefinedName', 'Missing', 1]);
  assert.equal(value("[Missing new] on: Error do: [:e | e messageText]"), 'Undefined name: Missing.');
  assert.equal(value("[#(1 2) at: 5] on: Error do: [:e | e messageText]"), 'Index 5 is outside 1 through 2.');
});

test('a class may override doesNotUnderstand: and handle a failed message', () => {
  const { runtime, value } = setup();
  const klass = runtime.defineClass('Forwarder');
  runtime.installSource(klass, 'doesNotUnderstand: aMessage ^aMessage selector -> aMessage arguments');
  const association = value('Forwarder new frob: 1 with: 2');
  assert.equal(association.slots.key.name, 'frob:with:');
  assert.deepEqual(association.slots.value, [1n, 2n]);
  assert.equal(value('[3 foo] on: MessageNotUnderstood do: [:e | e receiver]'), 3n);
  assert.equal(value('[3 foo: 4] on: MessageNotUnderstood do: [:e | e message arguments first]'), 4n);
  assert.equal(value('[3 foo] on: MessageNotUnderstood do: [:e | e message printString]'), 'foo #()');
});

test('exception messages fail outside an active signal and handler blocks need one argument', () => {
  const { value } = setup();
  assert.equal(value('| saved | [Warning signal] on: Warning do: [:e | saved := e]. [saved resume: 1] on: Error do: [:e | e messageText]'),
    'The exception is not signaled in this process.');
  assert.equal(value('[Error new pass] on: Error do: [:e | e messageText]'), 'The exception is not signaled in this process.');
  assert.equal(value('[[1] on: Error do: [2]] on: Error do: [:e | e messageText]'), 'on:do: requires a handler block with one argument.');
  assert.equal(value('[[1] ensure: 2] on: Error do: [:e | e messageText]'), 'ifCurtailed: requires a termination block without arguments.');
});

test('stop on signal pauses at each signal, including handled ones', () => {
  const { runtime, run } = setup();
  const debugger_ = new Debugger(runtime);
  assert.deepEqual(debugger_.dispatch({ op: 'stopOnSignal', value: true }), { stopOnSignal: true });
  let state = run('[ZeroDivide new signal: #z] on: ZeroDivide do: [:e | 4]');
  assert.deepEqual([state.status, state.stop.reason], ['paused', 'signal']);
  const encoded = debugger_.inspect(state.id);
  assert.equal(encoded.stop.exception.kind, 'object');
  assert.equal(debugger_.object(encoded.stop.exception.id).className, 'ZeroDivide');
  state = runtime.resume(state.id);
  assert.deepEqual([state.status, state.result], ['completed', 4n]);
  debugger_.dispatch({ op: 'stopOnSignal', value: false });
  assert.equal(runtime.stopOnSignal, false);
  assert.throws(() => debugger_.dispatch({ op: 'stopOnSignal', value: 1 }), /stopOnSignal requires a Boolean value/);
  state = run('Error signal');
  assert.equal(debugger_.inspect(state.id).stop.error.name, 'Error');
  assert.equal(debugger_.inspect(state.id).stop.exception.kind, 'object');
});

test('a host rejection signals an Error that a handler can catch', async () => {
  const runtime = new Runtime({ sources: kernel });
  const runner = new ProcessRunner(runtime);
  const host = new Host(runtime, runner);
  const request = Promise.withResolvers();
  const service = host.value({ fetch: () => new HostOperation(request.promise) });
  const klass = runtime.defineClass('Fetcher', { slots: ['service'] });
  runtime.installSource(klass, "fetch ^[(service call: 'fetch') , ' ok'] on: Error do: [:e | e messageText , ' handled']");
  const fetcher = runtime.newObject(klass);
  fetcher.slots.service = service;
  const process = runtime.start(fetcher, 'fetch');
  assert.equal(runtime.run(process).status, 'waiting');
  const ready = runtime.whenReady(process);
  request.reject(new Error('offline'));
  await ready;
  assert.deepEqual([runtime.inspect(process).stop.reason], ['ready']);
  const state = runtime.resume(process);
  assert.deepEqual([state.status, state.result], ['completed', 'offline handled']);
  runner.close();
});

test('a failing exception description stops after the failure limit', () => {
  const { runtime, run } = setup();
  runtime.installSource(runtime.classes.get('MessageNotUnderstood'), 'description ^self broken');
  const state = run('3 foo', 10_000_000);
  assert.deepEqual([state.status, state.stop.reason, state.stop.error.message], ['paused', 'error', 'MessageNotUnderstood does not understand broken.']);
  assert.equal(state.frames.filter(frame => frame.selector === 'doesNotUnderstand:').length, Runtime.failureLimit);
});
