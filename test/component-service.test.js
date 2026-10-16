import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { encode, decode } from '../components/values.js';
import { ComponentService } from '../server/component-service.mjs';

test('the component service runs server components in a child process', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-component-service-'));
  const service = new ComponentService({ directory, namespace: 'test' });
  try {
    const source = await readFile(new URL('../examples/components/disk-reader.mjs', import.meta.url), 'utf8');
    const reader = await service.invoke({ op: 'modules.install', files: { 'index.mjs': source },
      manifest: { name: 'disk-reader', target: 'server', interface: { className: 'DiskReader', messages: { usage: { method: 'usage', arity: 0 } } } } });
    assert.match(reader.url, new RegExp(`^/components/test/versions/${reader.version}/index\\.mjs$`));
    const disk = await service.invoke({ op: 'objects.create', runtime: 'server', version: reader.version, configuration: encode({ path: directory }) });
    assert.equal(disk.reference.namespace, 'test');
    assert.equal(disk.status, 'ready');
    const call = await service.invoke({ op: 'objects.send', target: disk.reference, selector: 'usage', args: encode([]) });
    assert.equal(call.status, 'completed');
    const usage = decode(call.result);
    assert.equal(usage.path, directory);
    assert.equal(usage.usedBytes, usage.totalBytes - usage.freeBytes);
    await assert.rejects(service.invoke({ op: 'objects.list', runtime: 'page' }), /no registered component runtime/);
    await assert.rejects(service.invoke({ op: 'objects.inspect', target: { ...disk.reference, namespace: 'other' } }), /namespace/);
    assert.equal(service.describe().runtimes.find(runtime => runtime.runtime === 'server').status, 'running');

    assert.deepEqual((await service.invoke({ op: 'modules.list' })).map(module => module.version), [reader.version]);
    assert.equal((await service.invoke({ op: 'runtimes.describe' })).namespace, 'test');
    assert.deepEqual(await service.invoke({ op: 'snapshots.list' }), []);

    const job = await service.invoke({ op: 'jobs.start', target: disk.reference, selector: 'usage', args: encode([]), label: 'Disk usage', input: { path: directory } });
    let record = job;
    const deadline = Date.now() + 5000;
    while (record.status === 'running') {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the job.');
      await new Promise(resolve => setTimeout(resolve, 10));
      record = await service.invoke({ op: 'jobs.inspect', id: job.id });
    }
    assert.equal(record.status, 'done');
    assert.equal(Object.hasOwn(record, 'result'), false);
    assert.equal(decode(record.call.result).path, directory);
    assert.deepEqual((await service.invoke({ op: 'jobs.list' })).map(item => item.id), [job.id]);

    for (const id of [call.id, job.id]) await service.invoke({ op: 'calls.release', target: disk.reference, id });
    await service.invoke({ op: 'objects.dispose', target: disk.reference });
    assert.equal(service.instances.size, 0);

    const incarnation = service.process.identity.incarnation;
    const restarts = await Promise.allSettled([1, 2].map(() => service.invoke({ op: 'runtimes.restart', expectedIncarnation: incarnation })));
    assert.deepEqual(restarts.map(outcome => outcome.status).sort(), ['fulfilled', 'rejected']);
    assert.match(restarts.find(outcome => outcome.status === 'rejected').reason.message, /incarnation conflict/);
    assert.notEqual(service.process.identity.incarnation, incarnation);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a browser debugger attachment admits one request at a time', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-component-service-'));
  const service = new ComponentService({ directory, namespace: 'test' });
  const respond = Promise.withResolvers();
  const endpoint = createServer(async (_request, response) => {
    await respond.promise;
    response.writeHead(500);
    response.end();
  });
  endpoint.listen(0, '127.0.0.1');
  await once(endpoint, 'listening');
  const identity = { namespace: 'test', runtime: 'browser-debug', incarnation: 'one' };
  try {
    await service.register({ identity, page: { connected: () => true, send: async () => null } });
    const request = { runtime: identity.runtime, incarnation: 'one', endpoint: `http://127.0.0.1:${endpoint.address().port}`, targetId: 'page' };
    const first = service.attach(request);
    await assert.rejects(service.attach(request), /already attached/);
    respond.resolve();
    await assert.rejects(first, /HTTP 500/);
    await assert.rejects(service.attach(request), /HTTP 500/);
  } finally {
    endpoint.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
