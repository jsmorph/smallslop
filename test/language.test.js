import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/index.js';

function run(runtime, source) {
  const state = runtime.run(runtime.evaluate(source));
  if (state.status !== 'completed') throw state.stop.error ?? new Error(`Process stopped: ${state.stop.reason}.`);
  return state.result;
}

test('class names resolve when code runs, so an undefined class can be repaired', () => {
  const runtime = new Runtime();
  const processId = runtime.evaluate('Later new isKindOf: Later');
  const paused = runtime.run(processId);
  assert.equal(paused.stop.error.name, 'UndefinedName');
  assert.equal(paused.stop.error.variable, 'Later');
  runtime.defineClass('Later');
  assert.equal(runtime.retry(processId).result, true);
  assert.throws(() => runtime.evaluate('later'), /Unknown name later/);
});

test('the Object protocol covers identity, copying, hashing, testing, and perform', () => {
  const runtime = new Runtime();
  const point = runtime.defineClass('Point', { slots: ['x', 'y'] });
  runtime.installSource(point, 'x: newX x := newX');
  runtime.installSource(point, 'x ^x');
  assert.equal(run(runtime, '| p q | p := Point new x: 3. q := p copy. q x: 4. p x'), 3n);
  assert.equal(run(runtime, '| p | p := Point new. p copy ~~ p'), true);
  assert.equal(run(runtime, '| p | p := Point new. p hash = p identityHash'), true);
  assert.equal(run(runtime, "'text' hash = 'text' copy hash"), true);
  assert.equal(run(runtime, '0.0 hash = -0.0 hash'), true);
  assert.equal(run(runtime, 'Point new isKindOf: Object'), true);
  assert.equal(run(runtime, 'Point new isMemberOf: Object'), false);
  assert.equal(run(runtime, "Point new respondsTo: 'x:'"), true);
  assert.equal(run(runtime, "3 perform: '+' with: 4"), 7n);
  assert.equal(run(runtime, "(Point new perform: 'x:' with: 5) x"), 5n);
  runtime.defineClass('Single', { slots: ['value'] });
  assert.equal(run(runtime, "(Point new perform: 'x:' withArguments: Single instVarNames) x"), 'value');
  assert.throws(() => run(runtime, "3 perform: 'negated' withArguments: Point allInstVarNames"), /negated expects 0 arguments/);
});

test('perform reports a missing method at the perform send, and retry repeats it', () => {
  const runtime = new Runtime();
  const klass = runtime.defineClass('Greeter');
  const processId = runtime.evaluate("Greeter new perform: 'greet'");
  const paused = runtime.run(processId);
  assert.equal(paused.stop.error.name, 'MessageNotUnderstood');
  assert.equal(paused.stop.error.selector, 'greet');
  assert.equal(paused.frames[0].pendingSend.selector, 'perform:');
  runtime.installSource(klass, "greet ^'hello'");
  assert.equal(runtime.retry(processId).result, 'hello');
  assert.throws(() => run(runtime, "Greeter new perform: 'greet' with: 1"), /greet expects 0 arguments/);
  assert.throws(() => run(runtime, 'Greeter new perform: 3'), /selector must be a nonempty String/);
  assert.throws(() => run(runtime, "nil error: 'Stopped here.'"), /Stopped here/);
});

test('classes describe their names, hierarchy, variables, and methods', () => {
  const runtime = new Runtime();
  const shape = runtime.defineClass('Shape', { slots: ['origin'], category: 'Graphics' });
  const circle = runtime.defineClass('Circle', { superclass: shape, slots: ['radius'], category: 'Graphics' });
  runtime.installSource(circle, 'radius ^radius');
  assert.equal(run(runtime, 'Circle name'), 'Circle');
  assert.equal(run(runtime, 'Circle category'), 'Graphics');
  assert.equal(run(runtime, 'Circle superclass'), shape);
  assert.deepEqual(run(runtime, 'Shape subclasses'), [circle]);
  assert.deepEqual(run(runtime, 'Shape allSubclasses'), [circle]);
  assert.deepEqual(run(runtime, 'Circle allSuperclasses'), [shape, runtime.classes.get('Object')]);
  assert.deepEqual(run(runtime, 'Circle instVarNames'), ['radius']);
  assert.deepEqual(run(runtime, 'Circle allInstVarNames'), ['origin', 'radius']);
  assert.deepEqual(run(runtime, 'Circle selectors'), ['radius']);
  assert.equal(run(runtime, "Circle includesSelector: 'radius'"), true);
  assert.equal(run(runtime, "Circle canUnderstand: 'isNil'"), true);
  assert.equal(run(runtime, 'Circle inheritsFrom: Shape'), true);
  assert.equal(run(runtime, 'Shape inheritsFrom: Shape'), false);
});
