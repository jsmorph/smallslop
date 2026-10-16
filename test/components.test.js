import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { encode, decode } from '../components/values.js';
import { ComponentStore } from '../server/component-store.mjs';
import { ComponentRuntime } from '../components/runtime.js';
import { ComponentRequests } from '../components/requests.js';

test('component values preserve exact data and references without reading accessors', () => {
  const reference = { catalog: 'test', runtime: 'server', incarnation: 'first', id: 'disk' };
  const object = {};
  const value = { integer: 9007199254740993n, missing: undefined, kind: 'integer', value: 'user data',
    floats: [-0, NaN, Infinity, -Infinity], data: Uint8Array.of(0, 255), reference: object };
  const encoded = encode(value, { reference: item => item === object ? reference : null });
  const decoded = decode(JSON.parse(JSON.stringify(encoded)), { reference: () => object });
  assert.deepEqual(decoded, value);
  let reads = 0;
  assert.throws(() => encode({ get value() { reads++; return 1; } }), /Accessor.*\$\.value/);
  assert.equal(reads, 0);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => encode(cycle), /Cyclic.*\$\.self/);
  assert.throws(() => encode(new Date()), /plain data/);
  assert.throws(() => encode({ text: 'x'.repeat(300) }, { maxBytes: 100 }), /exceeds 100 bytes/);
  assert.throws(() => decode({ kind: 'reference', value: { id: 'disk' } }), /incarnation/);
  const record = JSON.parse('{"__proto__":{"x":1}}');
  assert.deepEqual(decode(encode(record)), record);
});

test('stored source versions are repeatable, independent, and checked before loading', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-components-'));
  const store = new ComponentStore(directory, 'test');
  const manifest = { name: 'test-reader', target: 'server', interface: { className: 'TestReader',
    messages: { value: { method: 'value', arity: 0 } } } };
  const files = { 'index.mjs': 'export function create() { return { value() { return 9007199254740993n; } }; }' };
  try {
    const installed = await store.install({ manifest, files });
    assert.equal((await store.install({ files, manifest })).version, installed.version);
    const other = await store.install({ manifest, files: { 'index.mjs': files['index.mjs'].replace('9007199254740993', '42') } });
    assert.notEqual(installed.version, other.version);
    const module = await import(installed.fileUrl);
    assert.equal(module.create().value(), 9007199254740993n);
    assert.equal((await store.list()).length, 2);
    await assert.rejects(store.install({ manifest, files: { ...files, '../escape.js': '' } }), /relative paths/);
    await writeFile(path.join(store.versionPath(installed.version), 'index.mjs'), 'changed');
    await assert.rejects(store.source(installed.version), /hash differs/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('component instances use Smallslop sends and retain execution and export failures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-component-runtime-'));
  const store = new ComponentStore(directory, 'test');
  const runtime = new ComponentRuntime({ catalog: 'test', name: 'server', source: async version => {
    const source = await store.source(version); return { ...source, loadUrl: source.fileUrl };
  } });
  try {
    const installed = await store.install({ manifest: { name: 'counter', target: 'server', interface: { className: 'Counter', messages: {
      'add:': { method: 'add', arity: 1 }, fail: { method: 'fail', arity: 0 }, invalid: { method: 'invalid', arity: 0 },
    } } }, files: { 'index.mjs': `export function create({start}) { return {
      count: start,
      async add(value) { this.count += value; return this.count; },
      fail() { throw new Error('method failed'); },
      invalid() { this.count++; return () => this.count; },
    }; }` } });
    const first = await runtime.create({ version: installed.version, configuration: encode({ start: 9007199254740993n }) });
    const second = await runtime.create({ version: installed.version, configuration: encode({ start: 10n }) });
    assert.equal(await runtime.send(first.reference, 'add:', [2n]), 9007199254740995n);
    assert.equal(await runtime.send(second.reference, 'add:', [3n]), 13n);
    const failure = await runtime.completed(runtime.start({ target: first.reference, selector: 'fail' }).id);
    assert.equal(failure.status, 'paused');
    assert.equal(failure.execution, 'failed');
    const details = await runtime.dispatch({ op: 'calls.inspect', id: failure.id });
    assert.equal(details.process.frames[0].selector, 'fail');
    await runtime.dispatch({ op: 'calls.cancel', id: failure.id });
    const invalid = await runtime.completed(runtime.start({ target: first.reference, selector: 'invalid' }).id);
    assert.equal(invalid.execution, 'completed');
    assert.equal(invalid.export, 'failed');
    assert.match(invalid.error.message, /Unsupported component value/);
    assert.equal((await runtime.dispatch({ op: 'calls.inspect', id: invalid.id })).resultHandle.kind, 'object');
    const instance = runtime.get(first.reference);
    runtime.runtime.installSource(instance.wrapper.klass, 'fail ^self repairedValue');
    const repair = await runtime.completed(runtime.start({ target: first.reference, selector: 'fail' }).id);
    assert.equal(repair.status, 'paused');
    assert.match(repair.error.message, /repairedValue/);
    runtime.runtime.installSource(instance.wrapper.klass, 'repairedValue ^42');
    await runtime.dispatch({ op: 'debug.smallslop', request: { op: 'retry', processId: repair.processId } });
    const repaired = await runtime.completed(repair.id);
    assert.equal(repaired.error, null);
    assert.equal(repaired.execution, 'completed');
    assert.equal(decode(repaired.result), 42n);
    const beforeCalls = runtime.calls.size;
    const beforeCount = instance.object.count;
    const evaluation = runtime.runtime.evaluate('self add: 1. self add: 2', { receiver: instance.wrapper });
    assert.throws(() => runtime.assertIdle(instance), /active processes/);
    runtime.runner.follow(evaluation);
    while (runtime.runtime.process(evaluation).status !== 'completed') await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(runtime.host.unwrap(runtime.runtime.process(evaluation).result), beforeCount + 3n);
    assert.equal(runtime.calls.size, beforeCalls, 'Inspector expressions retain their own process, without mislabelling several sends as one component call.');
    runtime.runtime.dispose(evaluation);
    await runtime.dispose(first.reference);
    assert.equal(await runtime.send(second.reference, 'add:', [1n]), 14n);
    assert.throws(() => runtime.get({ ...second.reference, incarnation: 'expired' }), /another runtime incarnation/);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('retained request IDs prevent repeat effects after reply loss, release, and expiration', async () => {
  const requests = new ComponentRequests({ maxActive: 1, maxCompleted: 2 });
  let effects = 0;
  const first = requests.reserve();
  const execute = async () => ++effects;
  const submitted = requests.submit(first.id, { op: 'change' }, execute);
  assert.equal(requests.submit(first.id, { op: 'change' }, execute).id, first.id);
  assert.throws(() => requests.submit(first.id, { op: 'different' }, execute), /different arguments/);
  const done = await requests.wait(first.id, submitted.revision);
  assert.equal(done.result, 1);
  assert.equal(effects, 1);
  requests.release(first.id);
  assert.throws(() => requests.submit(first.id, { op: 'change' }, execute), /expired/);
  const later = [];
  for (let index = 0; index < 3; index++) {
    const ticket = requests.reserve(); later.push(ticket.id);
    const state = requests.submit(ticket.id, { op: 'change' }, execute);
    await requests.wait(ticket.id, state.revision);
  }
  assert.throws(() => requests.get(later[0]), /expired/);
  assert.equal(effects, 4);
  assert.throws(() => new ComponentRequests({ maxActive: 1, maxCompleted: 2 }).get(later[1]), /unavailable server incarnation/);
});

test('request waiters reject when an unused reservation expires', async () => {
  const requests = new ComponentRequests({ maxActive: 1, maxCompleted: 1 });
  const first = requests.reserve();
  const waiting = requests.wait(first.id, 0);
  requests.reserve();
  await assert.rejects(waiting, /expired/);
  const second = requests.reserve();
  const released = requests.wait(second.id, 0);
  requests.release(second.id);
  await assert.rejects(released, /expired/);
});

test('cancelled component work stays owned and cleanup failures remain inspectable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-component-lifecycle-'));
  const store = new ComponentStore(directory, 'test');
  const runtime = new ComponentRuntime({ catalog: 'test', name: 'server', maxActive: 1, maxCalls: 2,
    source: async version => { const source = await store.source(version); return { ...source, loadUrl: source.fileUrl }; } });
  try {
    const installed = await store.install({ manifest: { name: 'lifecycle', target: 'server', interface: { className: 'Lifecycle',
      messages: { wait: { method: 'wait', arity: 0 }, value: { method: 'value', arity: 0 } } } }, files: { 'index.mjs': `
export function create(config, context) {
  let finish;
  return { aborted: false, cleanupAttempts: 0,
    wait() { return context.operation(new Promise(resolve => { finish = resolve; }), () => { this.aborted = true; }); },
    finish() { finish(42n); }, value() { return 1n; },
    dispose() { if (++this.cleanupAttempts === 1) throw new Error('cleanup failed'); }
  };
}` } });
    const created = await runtime.create({ version: installed.version });
    const instance = runtime.get(created.reference);
    const call = runtime.start({ target: created.reference, selector: 'wait' });
    while (!instance.scope.tasks.size) await new Promise(resolve => setTimeout(resolve, 0));
    assert.throws(() => runtime.start({ target: created.reference, selector: 'value' }), /active call limit/);
    await runtime.dispatch({ op: 'calls.cancel', id: call.id });
    assert.equal((await runtime.completed(call.id)).status, 'cancelled');
    assert.equal(instance.object.aborted, true);
    assert.throws(() => runtime.assertIdle(instance), /host tasks/);
    await assert.rejects(runtime.dispatch({ op: 'calls.release', id: call.id }), /remaining host execution/);
    instance.object.finish();
    while (instance.scope.tasks.size) await new Promise(resolve => setTimeout(resolve, 0));
    const finished = await runtime.dispatch({ op: 'calls.inspect', id: call.id });
    assert.equal(finished.execution, 'completed');
    assert.deepEqual(finished.resultHandle, { kind: 'integer', value: '42' });
    await runtime.send(created.reference, 'value', []);
    assert.throws(() => runtime.start({ target: created.reference, selector: 'value' }), /Release completed calls/);
    await runtime.dispatch({ op: 'calls.release', id: call.id });
    assert.equal(await runtime.send(created.reference, 'value', []), 1n);
    await assert.rejects(runtime.dispose(created.reference), /cleanup failed/);
    assert.equal(runtime.describe(instance).status, 'failed');
    assert.match(runtime.describe(instance).error.message, /cleanup failed/);
    assert.equal((await runtime.dispose(created.reference)).status, 'disposed');
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('bad component source and constructors retain diagnostic records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-component-failures-'));
  const store = new ComponentStore(directory, 'test');
  const runtime = new ComponentRuntime({ catalog: 'test', name: 'server', source: async version => {
    const source = await store.source(version); return { ...source, loadUrl: source.fileUrl };
  } });
  try {
    for (const [name, source, error] of [
      ['syntax', 'export function create( {', /Unexpected/],
      ['missing-import', "import './missing.mjs'; export function create() { return {}; }", /Cannot find module/],
      ['constructor', "export function create() { throw new Error('constructor failed'); }", /constructor failed/],
    ]) {
      const installed = await store.install({ manifest: { name, target: 'server', interface: { className: 'BadComponent', messages: {} } }, files: { 'index.mjs': source } });
      await assert.rejects(runtime.create({ version: installed.version }), error);
      assert.equal((await store.source(installed.version)).files['index.mjs'], source);
      if (name === 'constructor') {
        const failed = (await runtime.dispatch({ op: 'objects.list' })).find(instance => instance.version === installed.version);
        assert.equal(failed.status, 'failed');
        assert.match(failed.error.stack, /constructor failed/);
        await runtime.dispose(failed.reference);
      } else assert.equal(runtime.modules.get(installed.version).status, 'failed');
    }
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('construction, disposal, and delayed reconnection preserve instance lifetime', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-component-concurrency-'));
  const store = new ComponentStore(directory, 'test');
  let bindingCheck;
  const runtime = new ComponentRuntime({ catalog: 'test', name: 'server',
    source: async version => { const source = await store.source(version); return { ...source, loadUrl: source.fileUrl }; },
    remote: async () => {
      if (bindingCheck) { bindingCheck.started.resolve(); await bindingCheck.done.promise; }
      return { status: 'ready', messages: { value: {} } };
    },
  });
  const dependency = { catalog: 'test', runtime: 'browser-test', incarnation: 'one', id: 'first' };
  let module;
  try {
    const installed = await store.install({ manifest: { name: 'concurrent-lifetime', target: 'server',
      interface: { className: 'Lifetime', messages: {} }, bindings: { dependency: ['value'] } }, files: { 'index.mjs': `
export const constructing = Promise.withResolvers();
export const constructed = Promise.withResolvers();
export const disposing = Promise.withResolvers();
export const disposed = Promise.withResolvers();
export let disposals = 0;
export async function create() {
  constructing.resolve(); await constructed.promise;
  return { async dispose() { disposals++; disposing.resolve(); await disposed.promise; } };
}` } });
    module = await import(installed.fileUrl);
    const creating = runtime.create({ version: installed.version, bindings: { dependency }, id: 'instance' });
    await module.constructing.promise;
    await assert.rejects(runtime.dispose(runtime.reference('instance')), /constructing|busy/);
    module.constructed.resolve();
    const instance = await creating;
    bindingCheck = { started: Promise.withResolvers(), done: Promise.withResolvers() };
    const reconnecting = runtime.reconnect({ target: instance.reference, name: 'dependency', expectedRevision: 0,
      expectedTarget: dependency, replacement: { ...dependency, id: 'second' } });
    const rejectedReconnection = assert.rejects(reconnecting, /disposing|disposed/);
    await bindingCheck.started.promise;
    const disposing = runtime.dispose(instance.reference);
    await module.disposing.promise;
    await assert.rejects(runtime.dispose(instance.reference), /disposing/);
    module.disposed.resolve();
    await disposing;
    bindingCheck.done.resolve();
    await rejectedReconnection;
    assert.equal(module.disposals, 1);
    assert.equal(runtime.get(instance.reference).bindings.dependency.revision, 0);
    assert.equal((await runtime.dispose(instance.reference)).status, 'disposed');
    assert.equal(module.disposals, 1);
  } finally {
    module?.constructed.resolve(); module?.disposed.resolve(); bindingCheck?.done.resolve();
    await runtime.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('workspace registrations preserve identity and guard calls, bindings, and owner disposal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-workspace-component-'));
  const store = new ComponentStore(directory, 'test');
  const runtime = new ComponentRuntime({ catalog: 'test', name: 'browser-test',
    source: async version => { const source = await store.source(version); return { ...source, loadUrl: source.fileUrl }; } });
  const klass = runtime.runtime.defineClass('Draft', { slots: ['service'] });
  const wrapper = runtime.runtime.newObject(klass);
  const waiting = Promise.withResolvers();
  const started = Promise.withResolvers();
  let disposed = false;
  try {
    const draft = runtime.register({ id: 'draft', wrapper, workspace: { kind: 'draft', id: 'draft' },
      messages: { read: { method: 'read', arity: 0 } },
      object: { read() { started.resolve(); return waiting.promise; }, dispose() { throw new Error('The application owns disposal.'); } } });
    assert.equal(runtime.get(draft.reference).wrapper, wrapper);
    assert.deepEqual(runtime.encode(wrapper), { kind: 'reference', value: draft.reference });
    await assert.rejects(runtime.dispose(draft.reference), /workspace owns/);
    const call = runtime.start({ target: draft.reference, selector: 'read' });
    await started.promise;
    await assert.rejects(runtime.disposeWorkspace([draft.reference], () => { disposed = true; }), /busy/);
    assert.equal(disposed, false);
    waiting.resolve(12n);
    assert.equal(decode((await runtime.completed(call.id)).result), 12n);
    const version = await store.install({ manifest: { name: 'draft-consumer', target: 'browser',
      interface: { className: 'DraftConsumer', messages: {} }, bindings: { draft: ['read'] } }, files: { 'index.mjs': 'export function create() { return {}; }' } });
    const consumer = await runtime.create({ version: version.version, bindings: { draft: draft.reference } });
    await assert.rejects(runtime.disposeWorkspace([draft.reference], () => { disposed = true; }), /consumers/);
    await runtime.dispose(consumer.reference);
    await assert.rejects(runtime.disposeWorkspace([draft.reference], () => { disposed = true; }, async () => { throw new Error('Remote consumer remains.'); }), /Remote consumer/);
    assert.equal(runtime.get(draft.reference).status, 'ready');
    assert.equal(disposed, false);
    await runtime.disposeWorkspace([draft.reference], async () => {
      assert.throws(() => runtime.start({ target: draft.reference, selector: 'read' }), /disposing/);
      disposed = true;
    });
    assert.equal(runtime.get(draft.reference).status, 'disposed');
    assert.throws(() => runtime.start({ target: draft.reference, selector: 'read' }), /disposed/);
  } finally { waiting.resolve(12n); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('local observations follow binding changes and retain callback work and errors', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-observation-'));
  const store = new ComponentStore(directory, 'test');
  const failures = [];
  const runtime = new ComponentRuntime({ catalog: 'test', name: 'browser-test', failed: error => failures.push(error),
    source: async version => { const source = await store.source(version); return { ...source, loadUrl: source.fileUrl }; } });
  try {
    const klass = runtime.runtime.defineClass('ObservedDraft', { slots: ['service'] });
    const create = id => runtime.register({ id, wrapper: runtime.runtime.newObject(klass), workspace: { kind: 'draft', id },
      messages: { state: { method: 'state', arity: 0 } }, object: { state: () => ({ id }) } });
    const first = create('first');
    const second = create('second');
    const module = await store.install({ manifest: { name: 'observer', target: 'browser', bindings: { draft: ['state'] },
      interface: { className: 'DraftObserver', messages: {} } }, files: { 'index.mjs': `export function create(config, context) {
        const object = { updates: [], pending: null, fail: false };
        context.observe('draft', async state => {
          object.updates.push(state.reference.id);
          if (object.fail) throw new Error('Observer failed.');
          if (object.pending) await object.pending;
        });
        return object;
      }` } });
    const observed = await runtime.create({ version: module.version, bindings: { draft: first.reference } });
    const instance = runtime.get(observed.reference);
    await setImmediate();
    assert.deepEqual(instance.object.updates, ['first']);
    runtime.objectChanged(first.reference); runtime.objectChanged(first.reference);
    await setImmediate();
    assert.deepEqual(instance.object.updates, ['first', 'first']);
    await runtime.reconnect({ target: observed.reference, name: 'draft', expectedRevision: 0, expectedTarget: first.reference, replacement: second.reference });
    await setImmediate();
    assert.equal(instance.object.updates.at(-1), 'second');
    const length = instance.object.updates.length;
    runtime.objectChanged(first.reference);
    await setImmediate();
    assert.equal(instance.object.updates.length, length);
    const waiting = Promise.withResolvers();
    instance.object.pending = waiting.promise;
    runtime.objectChanged(second.reference);
    await setImmediate();
    await assert.rejects(runtime.dispose(observed.reference), /host tasks/);
    waiting.resolve(); await setImmediate();
    instance.object.pending = null; instance.object.fail = true;
    runtime.objectChanged(second.reference); await setImmediate();
    assert.match(instance.error.message, /Observer failed/);
    assert.equal(failures.length, 1);
    await runtime.dispose(observed.reference);
    assert.equal(runtime.observers.size, 0);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('successful release preserves pauses, failures, debugger inspection, and explicit retention', async () => {
  const runtime = new ComponentRuntime({ catalog: 'test', name: 'browser-test', maxCalls: 4 });
  let waiting = Promise.withResolvers();
  const klass = runtime.runtime.defineClass('ReleaseTest', { slots: ['service'] });
  const target = runtime.register({ id: 'release-test', wrapper: runtime.runtime.newObject(klass), workspace: { kind: 'test', id: 'release-test' },
    messages: { read: { method: 'read', arity: 0 }, wait: { method: 'wait', arity: 0 }, fail: { method: 'fail', arity: 0 } },
    object: { read: () => 42n, wait: () => waiting.promise, fail() { throw new Error('Read failed.'); } } }).reference;
  const remote = new ComponentRuntime({ catalog: 'test', name: 'browser-caller', remote: request => runtime.dispatch(request) });
  const options = { releaseOnSuccess: true };
  try {
    for (let i = 0; i < 12; i++) {
      assert.equal(await runtime.send(target, 'read', [], options), 42n);
      assert.equal(await remote.send(target, 'read', [], options), 42n);
    }
    assert.equal(runtime.calls.size, 0);
    assert.equal(runtime.runtime.processes.size, 0);
    assert.equal(await runtime.send(target, 'read', []), 42n);
    assert.equal(runtime.calls.size, 1);
    runtime.release([...runtime.calls.keys()][0]);
    await assert.rejects(runtime.send(target, 'fail', [], options), /Read failed/);
    const failed = [...runtime.calls.values()][0];
    assert.equal(failed.status, 'paused');
    assert.equal(failed.retained, true);
    await runtime.dispatch({ op: 'calls.cancel', id: failed.id });
    runtime.release(failed.id);
    for (const retain of [call => runtime.dispatch({ op: 'calls.retain', id: call.id }), call => runtime.debugger.inspect(call.processId)]) {
      waiting = Promise.withResolvers();
      const result = runtime.send(target, 'wait', [], options);
      const call = [...runtime.calls.values()][0];
      await retain(call);
      waiting.resolve(7n);
      assert.equal(await result, 7n);
      assert.equal(runtime.calls.size, 1);
      assert.equal(runtime.describeCall(call).retained, true);
      runtime.release(call.id);
    }
    const point = runtime.runtime.breakpoint(klass.methods.get('read'));
    const result = runtime.send(target, 'read', [], options);
    const call = [...runtime.calls.values()][0];
    while (call.status !== 'paused') await new Promise(resolve => setTimeout(resolve, 1));
    runtime.runtime.clearBreakpoint(point);
    await runtime.dispatch({ op: 'debug.smallslop', request: { op: 'resume', processId: call.processId } });
    assert.equal(await result, 42n);
    assert.equal(runtime.calls.size, 1);
    runtime.release(call.id);
    const caller = remote.register({ id: 'caller', wrapper: remote.runtime.newObject(remote.runtime.defineClass('Caller', { slots: ['service'] })),
      workspace: { kind: 'test', id: 'caller' }, messages: {}, object: {} });
    const owner = remote.get(caller.reference);
    const releasing = Promise.withResolvers();
    const releaseStarted = Promise.withResolvers();
    remote.remote = async request => {
      if (request.op === 'calls.release') { releaseStarted.resolve(); await releasing.promise; }
      return runtime.dispatch(request);
    };
    const owned = remote.send(target, 'read', [], { ...options, owner });
    await releaseStarted.promise;
    assert.throws(() => remote.assertIdle(owner), /host tasks/);
    releasing.resolve();
    assert.equal(await owned, 42n);
    remote.assertIdle(owner);
    remote.remote = request => {
      if (request.op === 'calls.release') throw new Error('Release transport failed.');
      return runtime.dispatch(request);
    };
    await assert.rejects(remote.send(target, 'read', [], options), error => error.phase === 'release'
      && decode(error.result) === 42n && runtime.calls.has(error.callId));
  } finally { waiting.resolve(0n); await remote.close(); await runtime.close(); }
});

test('saved component source and declared state reconstruct exact versions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-saved-'));
  const store = new ComponentStore(directory, 'test');
  const createRuntime = () => new ComponentRuntime({ catalog: 'test', name: 'server', source: async version => {
    const source = await store.source(version); return { ...source, loadUrl: source.fileUrl };
  } });
  const first = createRuntime(), second = createRuntime();
  try {
    const module = await store.install({ manifest: { name: 'saved-counter', target: 'server', interface: { className: 'SavedCounter',
      messages: { read: { method: 'read', arity: 0 }, 'add:': { method: 'add', arity: 1 } } } },
      files: { 'index.mjs': `export function create({start}) {
        let count = start;
        return { read: () => count, add: value => count += value,
          async snapshot() { if (this.pending) await this.pending; return {count}; },
          restore(value) { count = value.count; } };
      }` } });
    const created = await first.create({ version: module.version, configuration: encode({ start: 3n }) });
    await first.send(created.reference, 'add:', [5n], { releaseOnSuccess: true });
    const instance = first.get(created.reference);
    first.runtime.installSource(instance.wrapper.klass, "read ^(service call: 'read') * 2", { protocol: 'custom' });
    const captured = await first.snapshot(created.reference);
    const saved = await store.saveSnapshot(captured);
    assert.equal((await store.saveSnapshot(captured)).id, saved.id);
    assert.notEqual(saved.version, module.version);
    assert.equal(decode(saved.state).count, 8n);
    await first.dispatch({ op: 'objects.saved', target: created.reference, expectedRevision: captured.revision, snapshot: saved.id,
      source: { manifest: captured.manifest, files: captured.files } });
    assert.equal(first.describe(instance).savedSnapshot, saved.id);
    const restored = await second.create({ ...(await store.snapshot(saved.id)), savedSnapshot: saved.id });
    assert.equal(await second.send(restored.reference, 'read', []), 16n);
    assert.equal(await second.send(restored.reference, 'add:', [1n]), 9n);
    assert.equal(await first.send(created.reference, 'read', []), 16n);
    const original = await second.create({ version: module.version, configuration: encode({ start: 3n }) });
    assert.equal(await second.send(original.reference, 'read', []), 3n);
    const waiting = Promise.withResolvers();
    instance.object.pending = waiting.promise;
    const changing = first.snapshot(created.reference);
    assert.equal(instance.status, 'snapshotting');
    await assert.rejects(first.dispose(created.reference), /snapshotting/);
    first.runtime.installSource(instance.wrapper.klass, "read ^(service call: 'read') * 3");
    waiting.resolve();
    await assert.rejects(changing, /changed while saving/);
    assert.equal(first.describe(instance).savedSnapshot, saved.id);
    assert.equal((await store.snapshots()).length, 1);
    await writeFile(store.snapshotPath(saved.id), '{}');
    await assert.rejects(store.snapshot(saved.id), /hash differs/);
  } finally { await first.close(); await second.close(); await rm(directory, { recursive: true, force: true }); }
});
