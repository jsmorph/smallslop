import test from 'node:test';
import assert from 'node:assert/strict';
import { Debugger, Runtime } from '../src/index.js';
import { createRepairDemo } from '../examples/repair.js';

const transport = debugger_ => request => JSON.parse(JSON.stringify(debugger_.dispatch(JSON.parse(JSON.stringify(request)))));

test('an agent repairs the nested-block example through JSON commands', () => {
  const { runtime, processId, klass } = createRepairDemo();
  const send = transport(new Debugger(runtime));
  let state = send({ op: 'run', processId });
  assert.equal(state.stop.reason, 'breakpoint');
  const frameId = state.frames[0].id;
  const receiver = send({ op: 'object', id: state.frames[0].receiver.id });
  assert.deepEqual(receiver.slots.visited, { kind: 'boolean', value: true });
  const evaluation = send({ op: 'evaluate', source: 'captured := 9007199254740993', processId, frameId });
  assert.deepEqual(send({ op: 'run', processId: evaluation.id }).result, { kind: 'integer', value: '9007199254740993' });
  state = send({ op: 'run', processId });
  assert.equal(state.stop.error.name, 'MessageNotUnderstood');
  assert.deepEqual(state.stop.error.arguments, [{ kind: 'integer', value: '9007199254740993' }]);
  send({ op: 'install', className: klass.name, source: 'finish: value ^value' });
  state = send({ op: 'retry', processId });
  assert.equal(state.status, 'completed');
  assert.deepEqual(state.result, { kind: 'integer', value: '9007199254740993' });
});

test('object handles preserve cycles and shared identity until release', () => {
  const runtime = new Runtime();
  const debugger_ = new Debugger(runtime);
  const klass = runtime.defineClass('Link', { slots: ['next', 'other'] });
  const object = runtime.newObject(klass);
  object.slots.next = object;
  object.slots.other = object;
  const handle = debugger_.value(object);
  const detail = debugger_.object(handle.id);
  assert.deepEqual(detail.slots.next, handle);
  assert.deepEqual(detail.slots.other, handle);
  assert.equal(debugger_.decode(handle), object);
  debugger_.release([handle.id]);
  assert.throws(() => debugger_.object(handle.id), /Unknown object handle/);
  assert.notEqual(debugger_.value(object).id, handle.id);
});

test('JSON encoding preserves special floats and rejects malformed values', () => {
  const debugger_ = new Debugger(new Runtime());
  for (const value of [0, -0, 1.25, NaN, Infinity, -Infinity, 9007199254740993n, null, true, 'text']) {
    assert.ok(Object.is(debugger_.decode(JSON.parse(JSON.stringify(debugger_.value(value)))), value));
  }
  assert.throws(() => debugger_.decode({ kind: 'integer', value: 42 }), /Invalid debugger value/);
  assert.throws(() => debugger_.decode({ kind: 'float', value: 'garbage' }), /Invalid debugger value/);
  assert.throws(() => debugger_.dispatch({ op: 'constructor' }), /Unknown debugger operation/);
});

test('an agent inspects source and places a breakpoint in a block', () => {
  const runtime = new Runtime();
  const send = transport(new Debugger(runtime));
  const evaluation = send({ op: 'evaluate', source: '[42] value' });
  const methodId = evaluation.frames[0].methodId;
  const method = send({ op: 'method', id: methodId });
  assert.equal(method.codes.length, 2);
  send({ op: 'breakpoint', methodId, path: method.codes[1].path });
  const paused = send({ op: 'run', processId: evaluation.id });
  assert.equal(paused.stop.reason, 'breakpoint');
  assert.deepEqual(paused.frames[0].codePath, method.codes[1].path);
  assert.equal(paused.frames[0].source.slice(paused.frames[0].position.start, paused.frames[0].position.end), '42');
});

test('scoped edits distinguish shadowed bindings in nested blocks', () => {
  const runtime = new Runtime();
  const send = transport(new Debugger(runtime));
  let state = send({ op: 'evaluate', source: '| x | x := 1. [:x | [x] value] value: 2' });
  const processId = state.id;
  const method = send({ op: 'method', id: state.frames[0].methodId });
  const inner = method.codes.find(code => code.path.length === 2);
  send({ op: 'breakpoint', methodId: method.id, path: inner.path });
  state = send({ op: 'run', processId });
  const frameId = state.frames[0].id;
  assert.deepEqual(state.frames[0].codePath, inner.path);
  state = send({ op: 'setVariable', processId, frameId, depth: 2, name: 'x', value: { kind: 'integer', value: '9' } });
  assert.equal(state.frames[0].scopes[1].x.value, '2');
  assert.equal(state.frames[0].scopes[2].x.value, '9');
  assert.throws(() => send({ op: 'setVariable', processId, frameId, depth: 0, name: 'x', value: { kind: 'nil' } }), /Unknown variable/);
  assert.equal(send({ op: 'run', processId }).result.value, '2');
});

test('an agent repairs evaluated arguments without replaying expressions', () => {
  const runtime = new Runtime();
  const send = transport(new Debugger(runtime));
  const { id: processId } = send({ op: 'evaluate', source: '| divisor | divisor := 0. 8 quo: divisor' });
  let state = send({ op: 'run', processId });
  assert.equal(state.stop.reason, 'error');
  const frameId = state.frames[0].id;
  send({ op: 'setVariable', processId, frameId, name: 'divisor', value: { kind: 'integer', value: '2' } });
  state = send({ op: 'retry', processId });
  assert.equal(state.stop.reason, 'error');
  assert.equal(state.frames[0].pendingSend.arguments[0].value, '0');
  state = send({ op: 'setSendOperand', processId, frameId, index: 1, value: { kind: 'integer', value: '2' } });
  assert.equal(state.frames[0].pendingSend.arguments[0].value, '2');
  assert.throws(() => send({ op: 'setSendOperand', processId, frameId, index: 2, value: { kind: 'nil' } }), /Invalid send operand/);
  assert.equal(send({ op: 'retry', processId }).result.value, '4');
});

test('browser metadata and guarded installation preserve method versions', () => {
  const runtime = new Runtime();
  const send = transport(new Debugger(runtime));
  const klass = runtime.defineClass('BrowserExample', { category: 'Examples', slots: ['count'] });
  const first = send({ op: 'install', className: klass.name, source: 'answer ^41', protocol: 'accessing', expectedMethodId: null });
  assert.deepEqual(send({ op: 'classes' }).find(item => item.name === klass.name), {
    name: klass.name, category: 'Examples', superclass: 'Object', slots: ['count'], classSlots: [], methodCount: 1, classMethodCount: 0,
  });
  const next = send({ op: 'install', className: klass.name, source: 'answer ^42', expectedMethodId: first.id, selector: 'answer' });
  assert.equal(next.protocol, 'accessing');
  assert.equal(next.format, 'source');
  assert.throws(() => send({ op: 'install', className: klass.name, source: 'answer ^99', expectedMethodId: first.id }), /method has changed/);
  assert.throws(() => send({ op: 'install', className: klass.name, source: 'other ^99', selector: 'answer' }), /Keep the selector/);
  assert.throws(() => send({ op: 'install', className: klass.name, source: 'answer ^99', protocol: '' }), /protocol needs a name/);
  assert.equal(klass.methods.get('answer').id, next.id);
  assert.equal(runtime.run(runtime.start(runtime.newObject(klass), 'answer')).result, 42n);
  assert.throws(() => runtime.defineClass('InvalidCategory', { category: '' }), /category needs a name/);
  assert.equal(runtime.classes.has('InvalidCategory'), false);
});

test('method browsing finds sends in blocks and distinguishes implementation forms', () => {
  const runtime = new Runtime();
  const send = transport(new Debugger(runtime));
  const klass = runtime.defineClass('BrowserExample');
  runtime.installSource(klass, 'answer ^[super yourself] value', { protocol: 'testing' });
  runtime.installSource(klass, "text ^'yourself'");
  const senders = send({ op: 'methods', sends: 'yourself' });
  assert.deepEqual(senders.map(method => `${method.className} ${method.selector}`), ['BrowserExample answer']);
  assert.equal(send({ op: 'methods', selector: 'yourself' })[0].format, 'primitive');
  assert.equal(send({ op: 'methods', className: 'Block', selector: 'whileTrue:' })[0].format, 'bytecode');
  assert.deepEqual(send({ op: 'methods', className: klass.name }).map(method => method.selector), ['answer', 'text']);
  assert.throws(() => send({ op: 'methods', className: 'Missing' }), /Unknown class/);
});
