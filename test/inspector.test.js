import assert from 'node:assert/strict';
import test from 'node:test';
import { Debugger, Host, ProcessRunner, Runtime } from '../src/index.js';
import { Inspectors } from '../src/inspector.js';

function setup() {
  const runtime = new Runtime();
  const runner = new ProcessRunner(runtime);
  const host = new Host(runtime, runner);
  const debugger_ = new Debugger(runtime);
  const inspectors = new Inspectors(host, debugger_);
  return { runtime, host, debugger_, inspectors, close() { inspectors.dispose(); runner.close(); } };
}

test('host inspection pages stored values without evaluating accessors', () => {
  const env = setup();
  try {
    let reads = 0;
    const record = { self: 9007199254740993n, missing: undefined, get computed() { reads++; return 42; } };
    record.cycle = record;
    const session = env.inspectors.open(env.host.value(record));
    let state = session.state();
    assert.equal(reads, 0);
    assert.equal(state.fields.find(field => field.name === 'computed').accessor, true);
    assert.deepEqual(state.fields.find(field => field.name === 'cycle').value, state.subject);
    session.command('select', 'property:self');
    assert.equal(session.selected(), 9007199254740993n);
    session.command('select', 'property:computed');
    assert.throws(() => session.selected(), /stored value/);
    session.command('expression', "self get: 'computed'");
    session.command('evaluate', 'run');
    assert.equal(session.result(), 42);
    assert.equal(reads, 1);
    const rows = env.inspectors.open(env.host.value(Array.from({ length: 1205 }, (_, i) => BigInt(i))));
    rows.command('page', 1100);
    state = rows.state();
    assert.equal(state.total, 1205);
    assert.equal(state.fields.length, 101);
    assert.equal(state.fields[1].value.value, '1100');
    assert.equal(state.fields[100].value.value, '1199');
  } finally { env.close(); }
});

test('inspectors retain shared objects and debugger processes independently', () => {
  const env = setup();
  try {
    const klass = env.runtime.defineClass('Sample', { slots: ['child'] });
    const object = env.runtime.newObject(klass);
    object.slots.child = object;
    const a = env.inspectors.open(object);
    a.command('select', 'slot:child');
    const b = env.inspectors.dispatch({ action: 'openSelected', id: a.id });
    assert.equal(env.inspectors.get(b.id).slots.subject, object);
    a.command('expression', 'self answer');
    a.command('evaluate', 'debug');
    assert.equal(a.state().process.stop.reason, 'pause');
    a.command('run');
    assert.equal(a.state().process.stop.error.name, 'MessageNotUnderstood');
    env.runtime.installSource(klass, 'answer ^9007199254740993');
    a.command('retry');
    const processId = a.state().process.id;
    assert.equal(a.result(), 9007199254740993n);
    env.inspectors.dispatch({ action: 'retain', id: a.id, processId });
    a.command('expression', 'self');
    a.command('evaluate', 'run');
    assert.equal(env.runtime.process(processId).result, 9007199254740993n);
    env.debugger_.releaseAll();
    env.inspectors.close(a.id);
    assert.equal(env.inspectors.get(a.id), a);
    env.inspectors.close(a.id, processId);
    assert.equal(env.runtime.processes.has(processId), false);
    assert.equal(env.inspectors.get(b.id).slots.subject, object);
    assert.deepEqual(env.inspectors.get(b.id).state().fields[1].value, b.subject);
  } finally { env.close(); }
});

test('inspector evaluations keep their receiver and own asynchronous work', async () => {
  const env = setup();
  try {
    let finish;
    const object = env.host.value({ wait: () => new Promise(resolve => { finish = resolve; }) });
    const session = env.inspectors.open(object);
    session.command('expression', "self call: 'wait'");
    session.command('evaluate', 'run');
    const processId = session.state().process.id;
    assert.equal(session.state().process.status, 'waiting');
    session.command('evaluate', 'run');
    assert.match(session.state().command.stop.error.message, /Complete or cancel/);
    env.inspectors.close(session.id);
    finish(42);
    await Promise.resolve();
    assert.equal(env.runtime.processes.has(processId), false);
    assert.equal(env.runtime.processes.size, 0);
  } finally { env.close(); }
});
