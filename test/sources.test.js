import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime, fileOut } from '../src/index.js';
import { loadSources } from '../src/sources.js';
import { readPackage, readPackageSync, sourceVersion, writeSourceFile } from '../server/source-files.mjs';
import { createSmallslopServer } from '../server/server.mjs';
import { SourceStore } from '../ui/sources.js';
import { readFileSync } from 'node:fs';

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

test('source packages read with versions, and writes check the version they replace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smallslop-root-'));
  try {
    await mkdir(join(root, 'user'));
    await writeFile(join(root, 'user', 'Being.st'), 'one');
    await writeFile(join(root, 'user', 'notes.txt'), 'ignored');
    const files = readPackageSync('user', root);
    assert.deepEqual(files, [{ name: 'Being.st', text: 'one', version: sourceVersion('one') }]);
    assert.deepEqual(await readPackage('user', root), files);
    assert.match(files[0].version, /^[A-Za-z0-9_-]{43}$/);

    assert.equal(await writeSourceFile(root, 'user', 'Being.st', 'two', files[0].version), sourceVersion('two'));
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), 'two');
    await assert.rejects(writeSourceFile(root, 'user', 'Being.st', 'three', files[0].version),
      error => error.status === 412 && error.version === sourceVersion('two') && /user\/Being.st changed since it was read/.test(error.message));
    assert.equal(await writeSourceFile(root, 'user', 'Animal.st', 'new', null), sourceVersion('new'));
    await assert.rejects(writeSourceFile(root, 'user', 'Animal.st', 'again', null), error => error.status === 412);
    await assert.rejects(writeSourceFile(root, 'user', '../Escape.st', 'x', null), error => error.status === 400);
    await assert.rejects(writeSourceFile(root, '..', 'Escape.st', 'x', null), error => error.status === 400);
    await assert.rejects(writeSourceFile(root, 'missing', 'Being.st', 'x', null), error => error.status === 404);

    const version = sourceVersion('two');
    const results = await Promise.allSettled([writeSourceFile(root, 'user', 'Being.st', 'four', version), writeSourceFile(root, 'user', 'Being.st', 'five', version)]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
    assert.equal(results[1].reason.status, 412);
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), 'four');
    assert.throws(() => readPackageSync('../user', root), error => error.status === 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the Web server serves packages and writes a source file only over the version it replaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smallslop-root-'));
  const app = createSmallslopServer({ root: process.cwd(), directories: ['src'], index: '/src/index.js', sourceRoot: root });
  try {
    await mkdir(join(root, 'user'));
    await writeFile(join(root, 'user', 'Being.st'), 'one');
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}/api/smalltalk/`;
    const [being] = await (await fetch(`${base}user`)).json();
    assert.deepEqual(being, { name: 'Being.st', text: 'one', version: sourceVersion('one') });
    assert.equal((await fetch(`${base}missing`)).status, 404);
    const put = (path, body, headers) => fetch(`${base}${path}`, { method: 'PUT', body, headers });
    let response = await put('user/Being.st', 'two', { 'If-Match': `"${being.version}"` });
    assert.deepEqual([response.status, response.headers.get('ETag')], [204, `"${sourceVersion('two')}"`]);
    response = await put('user/Being.st', 'three', { 'If-Match': `"${being.version}"` });
    assert.deepEqual([response.status, response.headers.get('ETag')], [412, `"${sourceVersion('two')}"`]);
    assert.equal((await put('user/Being.st', 'three', {})).status, 428);
    assert.equal((await put('user/Being.st', 'three', { 'If-Match': 'unquoted' })).status, 400);
    assert.equal((await put('user/Being.st', 'three', { 'If-Match': `"${sourceVersion('two')}"`, Origin: 'http://elsewhere.example' })).status, 403);
    assert.equal((await put('user/bad name.st', 'x', { 'If-None-Match': '*' })).status, 400);
    assert.equal((await put('nowhere/Being.st', 'x', { 'If-None-Match': '*' })).status, 404);
    assert.equal((await put('user/Animal.st', 'new', { 'If-None-Match': '*' })).status, 204);
    assert.equal((await put('user/Animal.st', 'again', { 'If-None-Match': '*' })).status, 412);
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), 'two');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the page source store writes changed classes and stops at a conflicting file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smallslop-root-'));
  const app = createSmallslopServer({ root: process.cwd(), directories: ['src'], index: '/src/index.js', sourceRoot: root });
  const reports = [];
  let store;
  try {
    await mkdir(join(root, 'user'));
    await writeFile(join(root, 'user', 'Being.st'), header + definition('Being'));
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = new URL(`http://127.0.0.1:${app.server.address().port}/api/smalltalk/`);
    const runtime = new Runtime({ sources: kernel });
    const packages = { user: readPackageSync('user', root) };
    loadSources(runtime, packages.user);
    store = new SourceStore({ runtime, packages, report: error => reports.push(error.message), base, defaultPackage: 'user' });
    const being = runtime.classes.get('Being');

    runtime.installSource(being, 'kind ^#being', { protocol: 'accessing' });
    await store.settled();
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), fileOut(being));

    const animal = runtime.defineClass('Animal', { superclass: being, category: 'Test' });
    runtime.installSource(animal, 'sound ^#none');
    await store.settled();
    assert.throws(() => readFileSync(join(root, 'user', 'Animal.st')), /ENOENT/);
    store.adopt(animal);
    await store.settled();
    assert.equal(await readFile(join(root, 'user', 'Animal.st'), 'utf8'), fileOut(animal));

    runtime.primitive(being, 'native', 0, () => 1n);
    runtime.installSource(being, 'kind ^#being');
    await store.settled();
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), fileOut(being));

    await writeFile(join(root, 'user', 'Being.st'), 'edited elsewhere');
    runtime.installSource(being, 'kind ^#changed');
    runtime.installSource(being, 'other ^1');
    await store.settled();
    runtime.installSource(being, 'third ^3');
    await store.settled();
    assert.equal(await readFile(join(root, 'user', 'Being.st'), 'utf8'), 'edited elsewhere');
    assert.deepEqual(reports, ["user/Being.st changed on the server after this page read it.  The page's changes to Being are not saved.  Reload the page to load the current file."]);
  } finally {
    store?.dispose();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
