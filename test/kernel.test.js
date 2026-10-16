import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/index.js';

function evaluate(runtime, source) {
  const state = runtime.run(runtime.evaluate(source));
  if (state.stop.reason === 'error') throw state.stop.error;
  assert.equal(state.status, 'completed');
  return state.result;
}

test('integer arithmetic remains exact and float conversion is explicit', () => {
  const runtime = new Runtime();
  assert.equal(evaluate(runtime, '9007199254740993 + 2'), 9007199254740995n);
  assert.equal(evaluate(runtime, '9007199254740993 * 9007199254740993'), 81129638414606699710187514626049n);
  assert.equal(evaluate(runtime, '7 quo: 3'), 2n);
  assert.equal(evaluate(runtime, '-7 quo: 3'), -2n);
  assert.equal(evaluate(runtime, '-7 rem: 3'), -1n);
  assert.equal(evaluate(runtime, '2 asFloat + 0.5'), 2.5);
  assert.equal(evaluate(runtime, '7.5 / 2.5'), 3);
  assert.equal(evaluate(runtime, '-2.75 truncated'), -2n);
  assert.throws(() => evaluate(runtime, '1 + 1.0'), /requires an Integer or Fraction. Convert Floats with asFloat/);
  assert.throws(() => evaluate(runtime, '3 quo: 0'), /zero/i);
});

test('Boolean methods evaluate the selected block and preserve nonlocal returns', () => {
  const runtime = new Runtime();
  assert.equal(evaluate(runtime, 'true ifTrue: [42] ifFalse: [self missing]'), 42n);
  assert.equal(evaluate(runtime, 'false ifTrue: [self missing] ifFalse: [23]'), 23n);
  assert.equal(evaluate(runtime, 'false and: [self missing]'), false);
  assert.equal(evaluate(runtime, 'true or: [self missing]'), true);
  assert.equal(evaluate(runtime, 'false not'), true);
  assert.equal(evaluate(runtime, 'true ifTrue: [^7]. 99'), 7n);
  assert.equal(evaluate(runtime, 'nil isNil'), true);
  assert.equal(evaluate(runtime, '1 ~= 2'), true);
});

test('a resumable loop computes an exact factorial without growing frames', () => {
  const runtime = new Runtime();
  const id = runtime.evaluate('| i result | i := 1. result := 1. [i <= 30] whileTrue: [result := result * i. i := i + 1]. result');
  let state = runtime.run(id, { budget: 15 });
  let maxFrames = 0;
  let runs = 1;
  while (state.status === 'paused' && state.stop.reason === 'budget' && runs++ < 1000) {
    maxFrames = Math.max(maxFrames, state.frames.length);
    state = runtime.run(id, { budget: 15 });
  }
  assert.equal(state.status, 'completed');
  assert.equal(state.result, 265252859812191058636308480000000n);
  assert.ok(maxFrames <= 3);
  assert.ok(runs > 10);
});

test('a failing loop condition retains its value for debugger inspection', () => {
  const runtime = new Runtime();
  const state = runtime.run(runtime.evaluate('[1] whileTrue: [nil]'));
  assert.equal(state.stop.reason, 'error');
  assert.match(state.stop.error.message, /requires a Boolean/);
  assert.deepEqual(state.frames[0].stack, [1n]);
  assert.throws(() => evaluate(runtime, 'Integer new'), /native value constructor/);
});
