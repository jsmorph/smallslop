import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentRepairDemo, runRepairDemo } from '../examples/repair.js';

test('the source-level debugger example completes a repaired send', () => {
  const demo = runRepairDemo();
  assert.equal(demo.result, 42n);
  assert.equal(demo.states.length, 4);
  assert.deepEqual(runAgentRepairDemo(), { kind: 'integer', value: '9007199254740993' });
});
