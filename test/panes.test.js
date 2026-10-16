import test from 'node:test';
import assert from 'node:assert/strict';
import { PaneWorld } from '../ui/panes.js';
import { readPackageSync } from '../server/source-files.mjs';

const sources = { kernel: readPackageSync('kernel'), tools: readPackageSync('tools'), workspace: readPackageSync('workspace') };

function workspace() {
  const extent = { width: 1200, height: 800 };
  let created = 0;
  const world = new PaneWorld({ sources, extent: () => extent,
    createView: () => { created++; return { render() {}, focus() {}, dispose() {} }; } });
  world.register({ id: 'printing', title: 'Printing' });
  return { world, extent, created: () => created };
}

test('closing and reopening retain the pane object and its host view', () => {
  const { world, created } = workspace();
  try {
    const pane = world.require('printing');
    world.send(pane.id, 'open');
    world.send(pane.id, 'close');
    assert.equal(pane.object.slots.visible, false);
    world.send(pane.id, 'open');
    assert.equal(world.require(pane.id), pane);
    assert.equal(pane.object.slots.visible, true);
    assert.equal(created(), 1);
    assert.ok(world.runtime.processes.size <= 1);
  } finally { world.dispose(); }
});

test('enlarging restores bounds and saved layouts fit a narrower page', () => {
  const { world, extent } = workspace();
  try {
    world.send('printing', 'open');
    const original = world.rectangle(world.require('printing'));
    world.send('printing', 'enlarge');
    assert.deepEqual(world.rectangle(world.require('printing')), { x: 0, y: 0, width: 1200, height: 800 });
    assert.throws(() => world.dispatch({ op: 'move', id: 'printing', x: 'bad', y: 3 }), /finite number/);
    assert.equal(world.require('printing').object.slots.enlarged, true);
    world.send('printing', 'enlarge');
    assert.deepEqual(world.rectangle(world.require('printing')), original);
    const layout = world.layout();
    extent.width = 375; extent.height = 420;
    world.restore(layout);
    assert.deepEqual(world.rectangle(world.require('printing')), { x: 0, y: 0, width: 375, height: 420 });
    assert.equal(world.require('printing').object.slots.visible, true);
  } finally { world.dispose(); }
});

test('invalid layout data preserves the current layout and debugger failures remain inspectable', () => {
  const { world } = workspace();
  try {
    const layout = world.layout();
    assert.throws(() => world.restore({ version: 1, panes: [{ ...layout.panes[0], x: 'bad' }] }), /finite number/);
    assert.deepEqual(world.layout(), layout);
    assert.throws(() => world.restore({ version: 1, panes: [layout.panes[0], layout.panes[0]] }), /duplicate/);
    assert.deepEqual(world.layout(), layout);
    assert.throws(() => world.send('printing', 'unknownPaneMessage'), /understand/);
    const failed = world.runtime.process(world.require('printing').last);
    assert.equal(failed.stop.reason, 'error');
    assert.ok(world.debugger.inspect(failed.id).frames.length > 0);
    const paused = world.runtime.start(world.require('printing').object, 'open', [], { scope: world.require('printing').scope });
    world.dispatch({ op: 'debug', request: { op: 'inspect', processId: paused } });
    assert.equal(world.runner.active.has(paused), false);
    assert.equal(world.runtime.process(paused).stop.reason, 'start');
  } finally { world.dispose(); }
});
