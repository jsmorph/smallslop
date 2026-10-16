import test from 'node:test';
import assert from 'node:assert/strict';
import { Code, Runtime, assemble } from '../src/index.js';
import { readPackageSync } from '../server/source-files.mjs';

const kernel = readPackageSync('kernel');

const code = (instructions, options = {}) => new Code({ ...options, bytes: assemble(instructions) });
const constant = value => code([['constant', 0], ['return']], { literals: [value] });
const setup = () => {
  const runtime = new Runtime({ sources: kernel });
  const klass = runtime.defineClass('Example', { slots: ['stored'] });
  return { runtime, klass, object: runtime.newObject(klass) };
};

test('sends use inherited methods and instance slots', () => {
  const { runtime, klass } = setup();
  const subclass = runtime.defineClass('Child', { superclass: klass });
  runtime.install(klass, 'store:', code([
    ['read', 0, 0], ['storeSlot', 0], ['return'],
  ], { args: ['value'], literals: ['stored'] }));
  runtime.install(subclass, 'store:', code([
    ['self'], ['read', 0, 0], ['superSend', 0, 1], ['pop'], ['slot', 1], ['return'],
  ], { args: ['value'], literals: ['store:', 'stored'] }));
  const object = runtime.newObject(subclass);
  assert.equal(runtime.run(runtime.start(object, 'store:', [9007199254740993n])).result, 9007199254740993n);
  assert.equal(object.slots.stored, 9007199254740993n);
});

test('active frames retain their method after replacement', () => {
  const { runtime, klass, object } = setup();
  const original = runtime.install(klass, 'answer', constant(1n));
  const point = runtime.breakpoint(original);
  const id = runtime.start(object, 'answer');
  const paused = runtime.run(id);
  assert.equal(paused.stop.reason, 'breakpoint');
  assert.equal(paused.frames[0].methodId, original.id);
  const replacement = runtime.install(klass, 'answer', constant(2n));
  assert.notEqual(replacement.id, original.id);
  runtime.clearBreakpoint(point);
  assert.equal(runtime.run(id).result, 1n);
  assert.equal(runtime.run(runtime.start(object, 'answer')).result, 2n);
});

test('debugger edits reach shared bindings captured through nested blocks', () => {
  const { runtime, klass, object } = setup();
  const inner = code([['read', 2, 0], ['return']]);
  const outer = code([['block', 0], ['send', 1, 0], ['return']], { literals: [inner, 'value'] });
  const method = runtime.install(klass, 'answer', code([
    ['constant', 0], ['write', 0, 0], ['pop'], ['block', 1], ['send', 2, 0], ['return'],
  ], { locals: ['captured'], literals: [10n, outer, 'value'] }));
  runtime.breakpoint(method, 0, inner);
  const id = runtime.start(object, 'answer');
  const paused = runtime.run(id);
  assert.equal(paused.frames.length, 4);
  assert.equal(paused.frames[0].scopes[2].captured, 10n);
  runtime.setVariable(id, paused.frames[0].id, 'captured', 42n);
  assert.equal(runtime.inspect(id).frames[2].scopes[0].captured, 42n);
  assert.equal(runtime.run(id).result, 42n);
});

test('closures keep their shared environment after the method returns', () => {
  const { runtime, klass, object } = setup();
  const getter = code([['read', 1, 0], ['return']]);
  runtime.install(klass, 'capture:', code([['block', 0], ['return']], {
    args: ['captured'], literals: [getter],
  }));
  const closure = runtime.run(runtime.start(object, 'capture:', [23n])).result;
  assert.equal(runtime.run(runtime.start(closure, 'value')).result, 23n);
});

test('nonlocal return unwinds the home activation and fails after it ends', () => {
  const { runtime, klass, object } = setup();
  const returning = code([['constant', 0], ['nonlocalReturn']], { literals: [7n] });
  runtime.install(klass, 'answer', code([
    ['block', 0], ['send', 1, 0], ['pop'], ['constant', 2], ['return'],
  ], { literals: [returning, 'value', 99n] }));
  assert.equal(runtime.run(runtime.start(object, 'answer')).result, 7n);
  runtime.install(klass, 'escape', code([['block', 0], ['return']], { literals: [returning] }));
  const closure = runtime.run(runtime.start(object, 'escape')).result;
  const failure = runtime.run(runtime.start(closure, 'value'));
  assert.equal(failure.stop.reason, 'error');
  assert.match(failure.stop.error.message, /home activation has ended/);
  assert.deepEqual(failure.frames[0].stack, [7n]);
});

test('a failed send retains its operands and can be repaired without replay', () => {
  const { runtime, klass, object } = setup();
  let effects = 0;
  runtime.primitive(klass, 'effect', 0, () => { effects++; return null; });
  runtime.install(klass, 'answer', code([
    ['self'], ['send', 0, 0], ['pop'], ['self'], ['constant', 1], ['send', 2, 1], ['return'],
  ], { literals: ['effect', 41n, 'missing:'] }));
  const id = runtime.start(object, 'answer');
  const failure = runtime.run(id);
  assert.equal(failure.stop.error.name, 'MessageNotUnderstood');
  assert.equal(failure.stop.error.receiver, object);
  assert.equal(failure.stop.error.selector, 'missing:');
  assert.deepEqual(failure.stop.error.arguments, [41n]);
  assert.deepEqual(failure.frames[0].stack, [object, 41n]);
  assert.throws(() => runtime.run(id), /Use retry/);
  assert.throws(() => runtime.retry(id, { budget: 0 }), /positive integer/);
  assert.throws(() => runtime.retry(id, { budget: null }), /positive integer/);
  assert.equal(runtime.inspect(id).stop.error, failure.stop.error);
  runtime.install(klass, 'missing:', code([['read', 0, 0], ['return']], { args: ['value'] }));
  assert.equal(runtime.retry(id).result, 41n);
  assert.equal(effects, 1);
});

test('primitive errors suspend before the send consumes operands', () => {
  const { runtime, klass, object } = setup();
  const error = new Error('Example failure');
  runtime.primitive(klass, 'fail:', 1, () => { throw error; });
  const failure = runtime.run(runtime.start(object, 'fail:', [3n]));
  assert.equal(failure.stop.error, error);
  assert.deepEqual(failure.frames[0].stack, [object, 3n]);
});

test('instruction stepping can enter, leave, and step over calls', () => {
  const { runtime, klass, object } = setup();
  runtime.install(klass, 'answer', constant(42n));
  const id = runtime.start(object, 'answer');
  assert.equal(runtime.step(id).frames[0].instruction.name, 'send');
  const entry = runtime.inspect(id).frames[0].id;
  assert.equal(runtime.step(id).frames[0].selector, 'answer');
  const out = runtime.stepOut(id);
  assert.equal(out.frames[0].id, entry);
  assert.deepEqual(out.frames[0].stack, [42n]);
  assert.equal(runtime.run(id).result, 42n);
  const other = runtime.start(object, 'answer');
  runtime.step(other);
  assert.deepEqual(runtime.stepOver(other).frames[0].stack, [42n]);
});

test('budgets, repeated breakpoints, and cancellation isolate processes', () => {
  const { runtime, klass, object } = setup();
  const loop = runtime.install(klass, 'loop', code([['jump', 0]]));
  const point = runtime.breakpoint(loop);
  const id = runtime.start(object, 'loop');
  assert.equal(runtime.run(id).stop.reason, 'breakpoint');
  assert.equal(runtime.run(id).stop.reason, 'breakpoint');
  runtime.clearBreakpoint(point);
  assert.equal(runtime.run(id, { budget: 20 }).stop.reason, 'budget');
  assert.equal(runtime.run(runtime.start(5n, 'yourself')).result, 5n);
  assert.equal(runtime.cancel(id).status, 'cancelled');
  assert.throws(() => runtime.run(id), /cancelled/);
});

test('step targets survive budgets, nested calls, and breakpoints', () => {
  const { runtime, klass, object } = setup();
  const inner = runtime.installSource(klass, 'inner ^42');
  runtime.installSource(klass, 'outer ^self inner');
  const id = runtime.start(object, 'outer');
  runtime.step(id);
  const entry = runtime.inspect(id).frames[0].id;
  let state = runtime.stepOver(id, { budget: 1 });
  assert.equal(state.stop.reason, 'budget');
  assert.deepEqual(state.action, { kind: 'stepOver', frameId: entry });
  const point = runtime.breakpoint(inner);
  state = runtime.resume(id);
  assert.equal(state.stop.reason, 'breakpoint');
  assert.equal(state.action.frameId, entry);
  state = runtime.resume(id, { budget: 1 });
  while (state.stop.reason === 'budget') state = runtime.stepOver(id, { budget: 1 });
  assert.equal(state.stop.reason, 'step');
  assert.equal(state.frames[0].id, entry);
  assert.deepEqual(state.frames[0].stack, [42n]);
  assert.equal(state.action, null);
  runtime.clearBreakpoint(point);
  assert.equal(runtime.run(id).result, 42n);

  const other = runtime.start(object, 'outer');
  runtime.step(other);
  runtime.step(other);
  const caller = runtime.inspect(other).frames[1].id;
  state = runtime.stepOut(other, { budget: 1 });
  while (state.stop.reason === 'budget') state = runtime.stepOut(other, { budget: 1 });
  assert.equal(state.stop.reason, 'step');
  assert.equal(state.frames[0].id, caller);
  assert.deepEqual(state.frames[0].stack, [42n]);
});

test('retry executes a repaired send at a breakpoint', () => {
  const { runtime, klass, object } = setup();
  const id = runtime.start(object, 'missing');
  runtime.step(id);
  const frame = runtime.frame(id, runtime.inspect(id).frames[0].id);
  runtime.breakpoint(frame.method, frame.pc);
  assert.equal(runtime.run(id).stop.reason, 'breakpoint');
  assert.equal(runtime.run(id).stop.reason, 'error');
  runtime.installSource(klass, 'missing ^42');
  assert.equal(runtime.retry(id).result, 42n);
});

test('invalid bytecode fails validation before it executes', () => {
  assert.throws(() => code([['pop'], ['return']]), /underflow/);
  assert.throws(() => code([['self']]), /fall past/);
  assert.throws(() => code([['jump', 1]]), /invalid instruction/);
  assert.throws(() => code([['self'], ['jump', 0]]), /Inconsistent/);
  assert.throws(() => assemble([['toString']]), /Invalid instruction/);
  assert.throws(() => new Code({ bytes: [0, 1] }), /Truncated/);
});
