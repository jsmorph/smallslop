import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime, fileOut } from '../src/index.js';
import { SourceStore, loadClassFile, loadSources } from '../src/sources.js';
import { SourceFiles, readPackage, readPackageSync, sourceRoot, sourceVersion } from '../server/source-files.mjs';
import { createSmallslopServer } from '../server/server.mjs';
import { ServerWorld } from '../server/world.mjs';

const kernel = readPackageSync('kernel');
const header = "Smalltalk interchangeVersion: '1.0'!\n";
const definition = (name, superclass = 'Object', slots = '') => `Class named: '${name}'
  superclass: '${superclass}'
  indexedInstanceVariables: #none
  instanceVariableNames: '${slots}'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Test'!
`;
const file = (name, text) => ({ name, text: header + text });

function run(runtime, source) {
  const state = runtime.run(runtime.evaluate(source), { budget: 100_000 });
  if (state.status !== 'completed') throw state.stop.error ?? new Error(`Process stopped: ${state.stop.reason}.`);
  return state.result;
}

test('loadSources defines superclasses first and installs methods after every class', () => {
  const runtime = new Runtime({ sources: kernel });
  const result = loadSources(runtime, [
    file('Animal.st', `${definition('Animal', 'Being', 'name')}Animal method!\nname ^name!\n`),
    file('Being.st', `${definition('Being')}Being method!\nkind ^#being!\n`),
    file('Integer.st', 'Integer method!\ndoubled ^self * 2!\n'),
  ]);
  assert.deepEqual(result, { classes: ['Being', 'Animal'], methods: ['Animal>>name', 'Being>>kind', 'Integer>>doubled'], failures: [] });
  assert.equal(run(runtime, 'Animal new kind').name, 'being');
  assert.equal(run(runtime, '21 doubled'), 42n);
});

test('loadSources requires one class per file and reports failures with file names', () => {
  const runtime = () => new Runtime({ sources: kernel });
  assert.throws(() => loadSources(runtime(), [file('Being.st', `${definition('Other')}`)]), /^Error: Being.st: Other belongs in its own file\./);
  assert.throws(() => loadSources(runtime(), [file('Being.st', 'Integer method!\nfoo ^1!\n')]), /Being.st: Integer belongs in its own file/);
  assert.throws(() => loadSources(runtime(), [{ name: 'notes.txt', text: header }]), /notes.txt: a source file is named ClassName.st/);
  assert.throws(() => loadSources(runtime(), [{ name: 'Being.st', text: 'Being method!\nfoo ^1!\n' }]), /^Error: Being.st: An interchange file starts with/);
  assert.throws(() => loadSources(runtime(), [file('A.st', definition('A', 'B')), file('B.st', definition('B', 'A'))]), /inherits from itself/);
  const result = loadSources(runtime(), [file('Being.st', `${definition('Being')}Being method!\nbroken ^(!\n`)]);
  assert.deepEqual(result.failures.map(failure => [failure.file, failure.className]), [['Being.st', 'Being']]);
  assert.throws(() => new Runtime(), /A runtime requires the kernel sources/);
});

test('every package in the repository loads without failures and files out unchanged', () => {
  const runtime = new Runtime({ sources: kernel });
  for (const name of ['tools', 'workspace', 'server']) assert.deepEqual(loadSources(runtime, readPackageSync(name)).failures, []);
  for (const name of ['kernel', 'tools', 'workspace', 'server']) {
    for (const { name: fileName, text } of readPackageSync(name)) {
      assert.equal(fileOut(runtime.classes.get(fileName.slice(0, -3))), text, `${name}/${fileName}`);
    }
  }
});

test('loadClassFile replaces a class from its file and keeps unchanged methods', () => {
  const runtime = new Runtime({ sources: kernel });
  const load = text => loadClassFile(runtime, file('Being.st', text));
  const method = (selector, source, protocol = 'accessing', kind = 'method') => `\nBeing ${kind}!\n${source}!\nAnnotation key: 'category' value: '${protocol}'!\n`;
  assert.deepEqual(load(definition('Being') + method('kind', 'kind ^#being') + method('name', 'name ^#a')), []);
  const being = runtime.classes.get('Being');
  const kind = being.methods.get('kind');
  runtime.primitive(being, 'native', 0, () => 1n);
  assert.deepEqual(load(definition('Being') + method('kind', 'kind ^#being') + method('size', 'size ^3', 'testing') + method('make', 'make ^self new', 'instance creation', 'classMethod')), []);
  assert.equal(being.methods.get('kind'), kind);
  assert.deepEqual([...being.methods.keys()].sort(), ['kind', 'native', 'size']);
  assert.equal(being.metaclass.methods.get('make').protocol, 'instance creation');
  assert.deepEqual(load(definition('Being') + method('kind', 'kind ^#being', 'other') + method('size', 'size ^3', 'testing')), []);
  assert.notEqual(being.methods.get('kind'), kind);
  assert.equal(being.methods.get('kind').protocol, 'other');
  assert.equal(being.metaclass.methods.has('make'), false);
  const failures = load(definition('Being') + method('broken', 'broken ^(', 'accessing'));
  assert.deepEqual(failures.map(failure => [failure.file, failure.className]), [['Being.st', 'Being']]);
  assert.deepEqual([...being.methods.keys()].sort(), ['kind', 'native', 'size']);
  runtime.removeMethod(being, 'size');
  assert.equal(being.methods.has('size'), false);
  assert.throws(() => runtime.removeMethod(being, 'size'), /Being has no method size/);
});

async function sourceRootWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'smallslop-root-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

test('SourceFiles reads packages with versions and writes only over the version it replaces', async () => {
  const root = await sourceRootWith({ 'user/Being.st': 'one', 'user/notes.txt': 'ignored' });
  const files = new SourceFiles(root);
  try {
    const read = files.readSync('user');
    assert.deepEqual(read, [{ name: 'Being.st', text: 'one', version: sourceVersion('one') }]);
    assert.deepEqual(await files.read('user'), read);
    assert.deepEqual(await readPackage('user', root), read);
    assert.match(read[0].version, /^[A-Za-z0-9_-]{43}$/);

    assert.equal(await files.write('user', 'Being.st', 'two', read[0].version), sourceVersion('two'));
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), 'two');
    await assert.rejects(files.write('user', 'Being.st', 'three', read[0].version),
      error => error.status === 412 && error.version === sourceVersion('two') && /user\/Being.st changed since it was read/.test(error.message));
    assert.equal(await files.write('user', 'Animal.st', 'new', null), sourceVersion('new'));
    await assert.rejects(files.write('user', 'Animal.st', 'again', null), error => error.status === 412);
    await assert.rejects(files.write('user', '../Escape.st', 'x', null), error => error.status === 400);
    await assert.rejects(files.write('..', 'Escape.st', 'x', null), error => error.status === 400);
    await assert.rejects(files.write('missing', 'Being.st', 'x', null), error => error.status === 404);
    await assert.rejects(files.write('user', 'Being.st', 'x'), error => error.status === 400);

    const version = sourceVersion('two');
    const results = await Promise.allSettled([files.write('user', 'Being.st', 'four', version), files.write('user', 'Being.st', 'five', version)]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
    assert.equal(results[1].reason.status, 412);
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), 'four');
    assert.throws(() => files.readSync('../user'), error => error.status === 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SourceFiles sends missed and new versions to the subscribers of a package', async () => {
  const root = await sourceRootWith({ 'user/Being.st': 'one', 'other/Thing.st': 'thing' });
  const files = new SourceFiles(root);
  const received = { a: [], b: [], c: [] };
  const listener = name => update => received[name].push(`${update.packageName}/${update.name}:${update.text}`);
  try {
    const a = await files.subscribe({ user: [{ name: 'Being.st', version: sourceVersion('one') }] }, listener('a'));
    await files.subscribe({ user: [] }, listener('b'));
    await files.subscribe({ other: [] }, listener('c'));
    assert.deepEqual(received, { a: [], b: ['user/Being.st:one'], c: ['other/Thing.st:thing'] });
    await files.write('user', 'Being.st', 'two', sourceVersion('one'));
    await assert.rejects(files.write('user', 'Being.st', 'three', sourceVersion('one')), error => error.status === 412);
    assert.deepEqual(received.a, ['user/Being.st:two', 'user/Being.st:two']);
    assert.deepEqual(received.b, ['user/Being.st:one', 'user/Being.st:two', 'user/Being.st:two']);
    assert.deepEqual(received.c, ['other/Thing.st:thing']);
    a();
    await files.write('user', 'Being.st', 'four', sourceVersion('two'));
    assert.equal(received.a.length, 2);
    await assert.rejects(files.subscribe({ '../user': [] }, listener('a')), error => error.status === 400);
    await assert.rejects(files.subscribe({ user: [{ name: 'Being.st' }] }, listener('a')), error => error.status === 400);
    await assert.rejects(files.subscribe(null, listener('a')), error => error.status === 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the Web server serves packages and answers only GET', async () => {
  const root = await sourceRootWith({ 'user/Being.st': 'one' });
  const app = createSmallslopServer({ root: process.cwd(), directories: ['src'], index: '/src/index.js', sourceRoot: root });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}/api/smalltalk/`;
    assert.deepEqual(await (await fetch(`${base}user`)).json(), [{ name: 'Being.st', text: 'one', version: sourceVersion('one') }]);
    assert.equal((await fetch(`${base}missing`)).status, 404);
    assert.equal((await fetch(`${base}user/Being.st`, { method: 'PUT', body: 'two' })).status, 405);
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), 'one');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function sharedRuntimes(root, names = ['a', 'b']) {
  const files = new SourceFiles(root);
  const runtimes = {};
  for (const name of names) {
    const runtime = new Runtime({ sources: kernel });
    const packages = { user: files.readSync('user') };
    loadSources(runtime, packages.user);
    const reports = [];
    const loaded = [];
    const store = new SourceStore({ runtime, packages, report: error => reports.push(error.message), label: `${name} runtime`, defaultPackage: 'user', loaded: className => loaded.push(className) });
    const write = (...args) => files.write(...args);
    store.attach(write);
    const unsubscribe = await files.subscribe(store.versions(), update => store.receive(update));
    runtimes[name] = { runtime, store, reports, loaded, write, unsubscribe, klass: className => runtime.classes.get(className) };
  }
  return { files, runtimes, async settled() { for (const { store } of Object.values(runtimes)) await store.settled(); },
    dispose() { for (const { store, unsubscribe } of Object.values(runtimes)) { unsubscribe(); store.dispose(); } } };
}

test('a class change in one runtime reaches every runtime that loaded its package', async () => {
  const root = await sourceRootWith({ 'user/Being.st': header + definition('Being') + "\nBeing method!\nkind ^#being!\nAnnotation key: 'category' value: 'accessing'!\n" });
  const shared = await sharedRuntimes(root);
  const { a, b } = shared.runtimes;
  try {
    const kind = b.klass('Being').methods.get('kind');
    a.runtime.installSource(a.klass('Being'), 'name ^#a', { protocol: 'accessing' });
    await shared.settled();
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), fileOut(a.klass('Being')));
    assert.equal(fileOut(b.klass('Being')), fileOut(a.klass('Being')));
    assert.equal(b.klass('Being').methods.get('kind'), kind);
    assert.deepEqual(b.loaded, ['Being']);

    b.runtime.removeMethod(b.klass('Being'), 'kind');
    await shared.settled();
    assert.equal(a.klass('Being').methods.has('kind'), false);

    const animal = a.runtime.defineClass('Animal', { superclass: a.klass('Being'), category: 'Test' });
    a.runtime.installSource(animal, 'sound ^#none');
    a.store.adopt(animal);
    await shared.settled();
    assert.equal(await readFile(join(root, 'user', 'Animal.st'), 'utf8'), fileOut(animal));
    assert.equal(fileOut(b.klass('Animal')), fileOut(animal));
    assert.equal(b.klass('Animal').superclass, b.klass('Being'));

    const loose = a.runtime.defineClass('Loose', { category: 'Test' });
    a.runtime.installSource(loose, 'value ^1');
    await shared.settled();
    assert.equal(b.klass('Loose'), undefined);
    assert.deepEqual([a.reports, b.reports], [[], []]);
  } finally {
    shared.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('a runtime reports unsaved changes that a newer file replaces and files that do not load', async () => {
  const root = await sourceRootWith({ 'user/Being.st': header + definition('Being') });
  const shared = await sharedRuntimes(root);
  const { a, b } = shared.runtimes;
  try {
    b.store.detach();
    b.runtime.installSource(b.klass('Being'), 'sound ^1');
    a.runtime.installSource(a.klass('Being'), 'color ^2');
    await shared.settled();
    assert.equal(b.klass('Being').methods.has('sound'), false);
    assert.equal(b.klass('Being').methods.get('color').code.source, 'color ^2');
    assert.deepEqual(b.reports, ["user/Being.st changed in another runtime before the b runtime saved its changes to Being.  The b runtime loaded the current file, and its unsaved changes to Being are lost."]);
    b.store.attach(b.write);
    await shared.settled();
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), fileOut(a.klass('Being')));

    const current = await readFile(join(root, 'user', 'Being.st'), 'utf8');
    await shared.files.write('user', 'Being.st', `${current}\nBeing method!\nbroken ^(!\n`, sourceVersion(current));
    assert.match(a.reports[0], /^The a runtime cannot load user\/Being.st, so it does not save Being: Being: /);
    a.runtime.installSource(a.klass('Being'), 'other ^3');
    await shared.settled();
    assert.match(await readFile(join(root, 'user', 'Being.st'), 'utf8'), /broken \^\(/);
    assert.equal(a.reports.length, 1);
  } finally {
    shared.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('a runtime that lost its connection during a write saves its later changes after reconnecting', async () => {
  const root = await sourceRootWith({ 'user/Being.st': header + definition('Being') });
  const shared = await sharedRuntimes(root, ['b']);
  const { b } = shared.runtimes;
  try {
    b.unsubscribe();
    b.store.attach(async (...args) => {
      await shared.files.write(...args);
      b.store.detach();
      throw new Error('The session connection closed.');
    });
    b.runtime.installSource(b.klass('Being'), 'size ^3');
    await shared.settled();
    b.runtime.installSource(b.klass('Being'), 'more ^4');
    b.unsubscribe = await shared.files.subscribe(b.store.versions(), update => b.store.receive(update));
    b.store.attach(b.write);
    await shared.settled();
    const text = await readFile(join(root, 'user', 'Being.st'), 'utf8');
    assert.equal(text, fileOut(b.klass('Being')));
    assert.match(text, /size \^3/);
    assert.match(text, /more \^4/);
    assert.deepEqual(b.reports, []);
  } finally {
    shared.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('the server runtime writes its class changes and loads changes from other runtimes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smallslop-root-'));
  const reports = [];
  let world;
  try {
    await cp(sourceRoot, root, { recursive: true });
    const files = new SourceFiles(root);
    world = new ServerWorld(':memory:', { sources: files, report: error => reports.push(error.message) });
    await world.subscription;
    await world.dispatch({ op: 'debug', request: { op: 'install', className: 'Integer', source: 'doubledForTest ^self * 2' } });
    await world.sources.settled();
    const integer = world.runtime.classes.get('Integer');
    const text = await readFile(join(root, 'kernel', 'Integer.st'), 'utf8');
    assert.equal(text, fileOut(integer));
    assert.match(text, /\nInteger method!\ndoubledForTest \^self \* 2!\n/);

    await files.write('kernel', 'Integer.st', `${text}\nInteger method!\ntripledForTest ^self * 3!\n`, sourceVersion(text));
    assert.equal(integer.methods.get('tripledForTest').code.source, 'tripledForTest ^self * 3');
    await world.close();
    world = null;
    assert.deepEqual(reports, []);
    assert.throws(() => new ServerWorld(':memory:', { sources: files }), /requires a report function/);
    assert.throws(() => new ServerWorld(':memory:', { report: () => {} }), /requires its SourceFiles/);
  } finally {
    await world?.close();
    await rm(root, { recursive: true, force: true });
  }
});
