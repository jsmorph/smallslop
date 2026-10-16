import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Debugger, Host, ProcessRunner, Runtime } from '../src/index.js';
import { readPackageSync } from '../server/source-files.mjs';

const kernel = readPackageSync('kernel');

async function collect() {
  await setImmediate();
  globalThis.gc();
  await setImmediate();
}

async function expectCollected(reference) {
  for (let turn = 0; turn < 20; turn++) {
    await collect();
    if (reference.deref() === undefined) return;
  }
  assert.fail('The runtime remains reachable after 20 collection turns.');
}

function waitingRuntime(operation) {
  const runtime = new Runtime({ sources: kernel });
  const completion = Promise.withResolvers();
  const runner = new ProcessRunner(runtime, { onChange(id) {
    const process = runtime.process(id);
    if (process.status === 'completed') {
      runner.close();
      completion.resolve(process.result);
    }
  } });
  const host = new Host(runtime, runner);
  const id = runtime.start(host.value({ wait: () => operation }), 'call:', ['wait']);
  runtime.run(id);
  runner.follow(id);
  return { reference: new WeakRef(runtime), completion: completion.promise, id };
}

test('pending host work retains its runtime until completion or cancellation', async () => {
  const first = Promise.withResolvers();
  const active = waitingRuntime(first.promise);
  await collect();
  assert.ok(active.reference.deref());
  first.resolve(42n);
  assert.equal(await active.completion, 42n);
  await expectCollected(active.reference);

  const second = Promise.withResolvers();
  const cancelled = waitingRuntime(second.promise);
  cancelled.reference.deref().cancel(cancelled.id);
  await expectCollected(cancelled.reference);
  second.resolve(7n);
});

test('disposed calls release entry methods while escaped blocks remain usable', async () => {
  const runtime = new Runtime({ sources: kernel });
  const baseline = runtime.methods.size;
  for (let i = 0; i < 1000; i++) {
    const id = runtime.start(null, 'yourself');
    runtime.run(id);
    runtime.dispose(id);
  }
  const escaped = runtime.evaluate('[42]');
  const block = runtime.run(escaped).result;
  const methodId = block.method.id;
  runtime.dispose(escaped);
  await collect();
  assert.equal(runtime.processes.size, 0);
  assert.equal(runtime.methods.size, baseline + 1);
  assert.equal(runtime.methods.get(methodId), block.method);
  const call = runtime.start(block, 'value');
  assert.equal(runtime.run(call).result, 42n);
  runtime.dispose(call);
  const cancelled = runtime.evaluate('42');
  assert.throws(() => runtime.dispose(cancelled), /completed or cancelled/);
  runtime.cancel(cancelled);
  runtime.dispose(cancelled);
  assert.throws(() => runtime.inspect(cancelled), /Unknown process/);
});

test('active frames, breakpoints, and debugger history retain old versions', async () => {
  const runtime = new Runtime({ sources: kernel });
  const debugger_ = new Debugger(runtime);
  const klass = runtime.defineClass('Versions');
  const object = runtime.newObject(klass);
  const originalId = runtime.installSource(klass, 'answer ^1').id;
  const point = runtime.breakpoint(runtime.methods.get(originalId));
  const call = runtime.start(object, 'answer');
  runtime.run(call);
  runtime.installSource(klass, 'answer ^2');
  debugger_.retainMethod(originalId);
  await collect();
  assert.equal(runtime.methods.get(originalId).code.source, 'answer ^1');
  runtime.clearBreakpoint(point);
  assert.equal(runtime.run(call).result, 1n);
  runtime.dispose(call);
  await collect();
  assert.equal(debugger_.method(originalId).codes[0].source, 'answer ^1');
  debugger_.releaseMethods([originalId]);
  await collect();
  assert.equal(runtime.methods.get(originalId), undefined);
  const current = runtime.start(object, 'answer');
  assert.equal(runtime.run(current).result, 2n);
  runtime.dispose(current);
});
