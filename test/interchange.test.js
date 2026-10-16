import test from 'node:test';
import assert from 'node:assert/strict';
import { Debugger, Runtime, SmallObject, fileIn, fileOut, interchangeChunks, parseInterchange, parseInterchangeElements } from '../src/index.js';
import { PaneWorld } from '../ui/panes.js';
import { BrowserService } from '../ui/system-browser.js';
import { readPackageSync } from '../server/source-files.mjs';

const kernel = readPackageSync('kernel');
const sources = { kernel, tools: readPackageSync('tools'), workspace: readPackageSync('workspace') };

function run(runtime, source) {
  const state = runtime.run(runtime.evaluate(source), { budget: 1_000_000 });
  if (state.status !== 'completed') throw state.stop.error ?? new Error(`Process stopped: ${state.stop.reason}.`);
  return state.result;
}

function definition(name, { superclass = 'Object', slots = '', classSlots = '', category = 'Test-Interchange' } = {}) {
  return `Class named: '${name}'
  superclass: '${superclass}'
  indexedInstanceVariables: #none
  instanceVariableNames: '${slots}'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: '${classSlots}'!
Annotation key: 'category' value: '${category}'!
`;
}

const point = `Smalltalk interchangeVersion: '1.0'!
"A point with a class-side counter."!
${definition('Point3', { slots: 'x y', classSlots: 'made' })}
Point3 method!
x
  ^x!
Annotation key: 'category' value: 'accessing'!

Point3 method!
x: newX y: newY
  x := newX. y := newY!
Annotation key: 'category' value: 'initializing'!

Point3 method!
greeting
  ^'Hi!! It''s ', x printString!

Point3 classMethod!
x: newX y: newY
  made := (made isNil ifTrue: [0] ifFalse: [made]) + 1.
  ^self new x: newX y: newY!
Annotation key: 'category' value: 'instance creation'!

Point3 classMethod!
made
  ^made!
`;

test('interchange chunks end at ! and keep doubled ! as text', () => {
  assert.deepEqual(interchangeChunks("a!! b! c!").map(chunk => chunk.text), ['a! b', ' c']);
  assert.throws(() => interchangeChunks('a! b'), /ends without a closing !/);
  assert.throws(() => parseInterchange('Object method!\nfoo ^1!'), /starts with Smalltalk interchangeVersion: '1.0'!/);
  assert.throws(() => parseInterchangeElements('Smalltalk at: #X put: 3!'), /Unsupported interchange element: Smalltalk at: #X put: 3/);
  assert.throws(() => parseInterchangeElements("Annotation key: 'a' value: 'b'!"), /must follow an element/);
  const [klass, method] = parseInterchangeElements(`${definition('A', { slots: 'p  q' })}A classMethod!\nmake ^self new!\n`);
  assert.deepEqual([klass.type, klass.name, klass.superclass, klass.slots, klass.classSlots, klass.annotations],
    ['class', 'A', 'Object', ['p', 'q'], [], { category: 'Test-Interchange' }]);
  assert.deepEqual([method.type, method.className, method.source], ['classMethod', 'A', 'make ^self new']);
});

test('file in defines classes and methods, and file out reproduces the text', () => {
  const runtime = new Runtime({ sources: kernel });
  const result = fileIn(runtime, point);
  assert.deepEqual(result, { classes: ['Point3'], methods: ['Point3>>x', 'Point3>>x:y:', 'Point3>>greeting', 'Point3 class>>x:y:', 'Point3 class>>made'], failures: [] });
  const klass = runtime.classes.get('Point3');
  assert.equal(klass.category, 'Test-Interchange');
  assert.equal(klass.methods.get('x').protocol, 'accessing');
  assert.equal(klass.methods.get('greeting').protocol, 'unclassified');
  assert.equal(run(runtime, '(Point3 x: 3 y: 4) x'), 3n);
  assert.equal(run(runtime, '(Point3 x: 5 y: 6) greeting'), "Hi! It's 5");
  assert.equal(run(runtime, 'Point3 made'), 2n);

  const text = fileOut(klass);
  assert.match(text, /^Smalltalk interchangeVersion: '1.0'!\nClass named: 'Point3'/);
  assert.match(text, /\^'Hi!! It''s ', x printString!/);
  const copy = new Runtime({ sources: kernel });
  assert.deepEqual(fileIn(copy, text).failures, []);
  assert.equal(fileOut(copy.classes.get('Point3')), text);
  assert.equal(run(copy, '(Point3 x: 1 y: 2) greeting'), "Hi! It's 1");
});

test('file in rejects class variables, pools, and indexed instance variables and reports method failures', () => {
  const runtime = new Runtime({ sources: kernel });
  const classVariables = definition('B').replace("classVariableNames: ''", "classVariableNames: 'Count'");
  const indexed = definition('C').replace('#none', '#object');
  const result = fileIn(runtime, `Smalltalk interchangeVersion: '1.0'!\n${classVariables}${indexed}${definition('D')}D method!\nbroken ^(!\nE method!\nfoo ^1!\n`);
  assert.deepEqual(result.classes, ['D']);
  assert.deepEqual(result.failures.map(failure => [failure.className, failure.message]), [
    ['B', 'B: class variables and shared pools are not supported.'],
    ['C', 'C: indexed instance variables are not supported.'],
    ['D', result.failures[2].message],
    ['E', 'Unknown class: E.'],
  ]);
  assert.match(result.failures[2].message, /Expected|Unexpected/);
});

test('redefinition keeps instances, reads new slots as nil, and recompiles dependent methods', () => {
  const runtime = new Runtime({ sources: kernel });
  fileIn(runtime, point);
  fileIn(runtime, `Smalltalk interchangeVersion: '1.0'!\n${definition('Point4', { superclass: 'Point3', slots: 'z' })}Point4 method!\nsum ^x + y + (z isNil ifTrue: [0] ifFalse: [z])!\n`);
  const klass = runtime.classes.get('Point3');
  const old = run(runtime, 'Point4 x: 1 y: 2');
  assert.ok(old instanceof SmallObject);

  assert.deepEqual(runtime.redefineClass(klass, { slots: ['x', 'y', 'w'], classSlots: ['made', 'note'] }), []);
  assert.deepEqual(runtime.classes.get('Point4').slots, ['x', 'y', 'w', 'z']);
  assert.equal(Object.hasOwn(old.slots, 'w'), false);
  const debugger_ = new Debugger(runtime);
  const handle = debugger_.value(old);
  assert.deepEqual(Object.keys(debugger_.object(handle.id).slots), ['x', 'y', 'w', 'z']);
  assert.deepEqual(debugger_.object(handle.id).slots.w, { kind: 'nil' });
  runtime.installSource(klass, 'w ^w', { protocol: 'accessing' });
  runtime.installSource(klass, 'w: value w := value', { protocol: 'accessing' });
  const process = runtime.start(old, 'w', []);
  assert.equal(runtime.run(process).result, null);
  runtime.run(runtime.start(old, 'w:', [7n]));
  assert.equal(runtime.run(runtime.start(old, 'w', [])).result, 7n);
  assert.equal(runtime.run(runtime.start(old, 'sum', [])).result, 3n);
  assert.equal(run(runtime, 'Point4 made'), 1n);
  assert.equal(run(runtime, 'Point3 made'), null);
  assert.equal(run(runtime, 'Point3 instVarNames size'), 3n);
  assert.equal(runtime.run(runtime.start(old, 'copy', [])).result.slots.w, 7n);

  const previous = klass.methods.get('x:y:');
  const failures = runtime.redefineClass(klass, { slots: ['y'] });
  assert.deepEqual(failures.map(({ className, selector }) => `${className}>>${selector}`).sort(),
    ['Point3>>w', 'Point3>>w:', 'Point3>>x', 'Point3>>x:y:', 'Point3>>greeting', 'Point4>>sum'].sort());
  assert.equal(klass.methods.get('x:y:'), previous);
  const stopped = runtime.run(runtime.start(old, 'x', []));
  assert.match(stopped.stop.error.message, /Unknown instance slot: x/);

  runtime.redefineClass(klass, { slots: ['x', 'y'], category: 'Test-Moved' });
  assert.equal(runtime.run(runtime.start(old, 'x', [])).result, 1n);
  assert.equal(klass.metaclass.category, 'Test-Moved');
});

test('redefinition refuses kernel classes, cycles, and conflicting slots without partial changes', () => {
  const runtime = new Runtime({ sources: kernel });
  fileIn(runtime, `Smalltalk interchangeVersion: '1.0'!\n${definition('A', { slots: 'a' })}${definition('B', { superclass: 'A', slots: 'b' })}`);
  const a = runtime.classes.get('A');
  const b = runtime.classes.get('B');
  for (const name of ['Object', 'Integer', 'String', 'Class']) {
    assert.throws(() => runtime.redefineClass(runtime.classes.get(name), {}), new RegExp(`${name} cannot be redefined`));
  }
  assert.throws(() => runtime.redefineClass(a.metaclass, {}), /cannot be redefined/);
  assert.throws(() => runtime.redefineClass(a, { superclass: b }), /A cannot inherit from itself/);
  assert.throws(() => runtime.redefineClass(a, { superclass: b.metaclass }), /Superclass must be a class/);
  assert.throws(() => runtime.redefineClass(a, { slots: ['a', 'b'], category: 'Elsewhere' }), /Duplicate slot in B/);
  assert.deepEqual([a.slots, b.slots, a.category], [['a'], ['a', 'b'], 'Test-Interchange']);
  assert.deepEqual(runtime.redefineClass(b, { superclass: runtime.objectClass }), []);
  assert.deepEqual([b.slots, b.metaclass.superclass], [['b'], runtime.objectClass.metaclass]);
});

test('the System Browser edits class definitions and files classes in and out', () => {
  const world = new PaneWorld({ sources, extent: () => ({ width: 1200, height: 800 }), createView: () => ({ render() {}, focus() {}, dispose() {} }) });
  try {
    const adapter = { runtime: world.runtime, host: world.host, inspector: world.debugger };
    const pane = world.register({ id: 'system-browser', title: 'System Browser', className: 'SystemBrowser' });
    const browser = new BrowserService(adapter, pane, { category: 'Workspace', className: 'Pane' });
    pane.browser = browser;
    const send = (selector, ...args) => { world.send(pane.id, selector, args); return browser.state(); };
    let state = browser.state();
    assert.equal(state.defining, true);
    assert.equal(state.editable, true);
    assert.match(state.source, /^Class named: 'Pane'\n  superclass: 'Object'/);

    send('newClass');
    state = browser.state();
    assert.match(state.source, /Class named: 'NewClass'\n  superclass: 'Pane'/);
    assert.equal(state.dirty, true);
    assert.throws(() => send('selectClass:', 'Pane'), /Accept or revert/);
    state = send('editSource:', state.source.replace("'NewClass'", "'Note'").replace("instanceVariableNames: ''", "instanceVariableNames: 'text'"));
    state = send('accept');
    assert.deepEqual([state.className, state.category, state.defining, state.dirty, state.message], ['Note', 'Workspace', true, false, 'Defined Note']);
    assert.equal(world.runtime.classes.get('Note').superclass, world.klass);

    send('newMethod');
    send('editSource:', 'text ^text');
    send('accept');
    send('selectProtocol:', null);
    state = send('selectClass:', 'Note');
    state = send('editSource:', state.source.replace("instanceVariableNames: 'text'", "instanceVariableNames: 'body'"));
    state = send('accept');
    assert.match(state.message, /^Defined Note\. Note>>text failed to recompile: Unknown name text/);
    send('editSource:', '"no definition"!');
    assert.throws(() => world.send(pane.id, 'accept'), /Accept one class definition/);
    send('revert');

    const { fileName, text } = browser.fileOut();
    assert.equal(fileName, 'Note.st');
    assert.match(text, /^Smalltalk interchangeVersion: '1.0'!\nClass named: 'Note'/);
    state = send('fileIn:', `Smalltalk interchangeVersion: '1.0'!\n${definition('Memo', { superclass: 'Note' })}Memo method!\ntitle ^'memo'!\nMemo method!\nbad ^(!\n`);
    assert.match(state.message, /^Filed in 1 class and 1 method\. Memo>>bad \^\( failed: /);
    assert.equal(world.runtime.classes.get('Memo').methods.get('title').protocol, 'unclassified');
  } finally { world.dispose(); }
});
