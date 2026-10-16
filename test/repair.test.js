import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentRepairDemo, runRepairDemo } from '../examples/repair.js';
import { readPackageSync } from '../server/source-files.mjs';

const kernel = readPackageSync('kernel');

test('the source-level debugger example completes a repaired send', () => {
  const demo = runRepairDemo(kernel);
  assert.equal(demo.result, 42n);
  assert.equal(demo.states.length, 4);
  assert.deepEqual(runAgentRepairDemo(kernel), { kind: 'integer', value: '9007199254740993' });
});
