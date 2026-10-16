import test from 'node:test';
import assert from 'node:assert/strict';
import { Code, Runtime, compileMethod } from '../src/index.js';

function evaluate(runtime, source, options) {
  const state = runtime.run(runtime.evaluate(source, options));
  if (state.stop.reason === 'error') throw state.stop.error;
  assert.equal(state.status, 'completed');
  return state.result;
}

test('literal parsing preserves integer precision and floating values', () => {
  const runtime = new Runtime();
  assert.equal(evaluate(runtime, '9007199254740993123456'), 9007199254740993123456n);
  assert.equal(evaluate(runtime, '-9007199254740993'), -9007199254740993n);
  assert.equal(evaluate(runtime, '2.5e2'), 250);
  assert.equal(evaluate(runtime, '-0.25'), -0.25);
  assert.equal(evaluate(runtime, "'a''b'"), "a'b");
  assert.equal(evaluate(runtime, '"a comment" nil'), null);
  assert.equal(evaluate(runtime, 'true'), true);
  assert.equal(evaluate(runtime, 'false'), false);
});

test('unary, binary, and keyword sends use Smalltalk precedence', () => {
  const runtime = new Runtime();
  const integer = runtime.classes.get('Integer');
  runtime.installSource(integer, 'plus: a times: b ^(self + a) * b');
  assert.equal(evaluate(runtime, '1 + 2 * 3'), 9n);
  assert.equal(evaluate(runtime, '1 + (2 * 3)'), 7n);
  assert.equal(evaluate(runtime, '1 + 2 negated'), -1n);
  assert.equal(evaluate(runtime, '2 plus: 1 + 2 times: 3'), 15n);
});

test('methods compile arguments, slots, super sends, and implicit self return', () => {
  const runtime = new Runtime();
  const base = runtime.defineClass('Base', { slots: ['stored'] });
  const child = runtime.defineClass('Child', { superclass: base });
  runtime.installSource(base, 'store: value stored := value');
  runtime.installSource(base, 'stored ^stored');
  runtime.installSource(child, 'store: value super store: value. ^self stored');
  assert.equal(evaluate(runtime, 'Child new store: 42'), 42n);
  const object = runtime.newObject(base);
  assert.equal(runtime.run(runtime.start(object, 'store:', [10n])).result, object);
  assert.equal(object.slots.stored, 10n);
});

test('blocks share bindings and can shadow outer names', () => {
  const runtime = new Runtime();
  assert.equal(evaluate(runtime, '| x f | x := 1. f := [x := 2]. f value. x'), 2n);
  assert.equal(evaluate(runtime, '| x | x := 1. [:x | | y | y := x. y] value: 8'), 8n);
  assert.equal(evaluate(runtime, '| x | x := 1. [| x | x := 2] value. x'), 1n);
  assert.equal(evaluate(runtime, '[] value'), null);
  assert.equal(evaluate(runtime, '| x y | x := y := 4. x == y'), true);
  assert.equal(evaluate(runtime, '[^23] value. 99'), 23n);
});

test('source positions and paused evaluation preserve lexical identity', () => {
  const runtime = new Runtime();
  const klass = runtime.defineClass('Example');
  const source = 'answer | captured | captured := 10. ^[[captured] value] value';
  const method = runtime.installSource(klass, source);
  const outer = method.code.literals.find(literal => literal instanceof Code);
  const inner = outer.literals.find(literal => literal instanceof Code);
  runtime.breakpoint(method, 0, inner);
  const id = runtime.start(runtime.newObject(klass), 'answer');
  const paused = runtime.run(id);
  assert.equal(paused.stop.reason, 'breakpoint');
  const position = paused.frames[0].position;
  assert.equal(source.slice(position.start, position.end), 'captured');
  const frameId = paused.frames[0].id;
  assert.equal(evaluate(runtime, 'captured := 42', { processId: id, frameId }), 42n);
  assert.equal(runtime.inspect(id).stop.reason, 'breakpoint');
  assert.equal(runtime.run(id).result, 42n);
});

test('syntax and binding errors report source locations', () => {
  const runtime = new Runtime();
  for (const source of ['foo | x x | ^x', 'foo ^missing', 'foo ^[1', 'foo ^1. 2', 'foo ^super', 'foo ^\'oops']) {
    assert.throws(() => compileMethod(runtime.objectClass, source), error =>
      error instanceof SyntaxError && Number.isInteger(error.position) && error.line >= 1 && error.column >= 1);
  }
  assert.throws(() => compileMethod(runtime.objectClass, 'foo\n ^missing'), error => error.line === 2 && error.column === 3);
});
