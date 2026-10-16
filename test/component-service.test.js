import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
