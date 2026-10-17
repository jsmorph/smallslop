import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerWorld, completed } from '../server/world.mjs';
import { SourceFiles } from '../server/source-files.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const report = error => { throw error; };
const sources = new SourceFiles();

test('SQL writes, exact values, and completed result pages share Smallslop objects', async () => {
  const world = new ServerWorld(':memory:', { sources, report });
  const execute = async (sql, parameters) => completed(await world.dispatch({ op: 'execute', sql, parameters })).result;
  try {
    await execute('CREATE TABLE items(id INTEGER PRIMARY KEY, text TEXT, bytes BLOB)');
    const inserted = await execute('INSERT INTO items VALUES ($id, $text, $bytes) RETURNING id, text, bytes', {
      id: { kind: 'integer', value: '9007199254740993' }, text: "quote'; test", bytes: { kind: 'bytes', value: [0, 255] },
    });
    assert.equal(inserted.rowsAffected.value, '1');
    await execute('UPDATE items SET text = ?', ['changed']);
    const page = completed(await world.dispatch({ op: 'next', id: inserted.id, count: 1 }));
    assert.deepEqual(page.value, [[{ kind: 'integer', value: '9007199254740993' }, "quote'; test", { kind: 'bytes', value: [0, 255] }]]);
    assert.equal(page.result.position.value, '1');
    assert.deepEqual(completed(await world.dispatch({ op: 'next', id: inserted.id })).value, []);
    assert.deepEqual(completed(await world.dispatch({ op: 'page', id: inserted.id, offset: 0, count: 1 })).value, page.value);
    const selected = await execute('SELECT text, text FROM items');
    assert.deepEqual(selected.columns.map(column => column.name), ['text', 'text']);
    assert.equal(selected.rowsAffected.value, '0');
    assert.deepEqual(completed(await world.dispatch({ op: 'next', id: selected.id })).value, [['changed', 'changed']]);
    const encoded = await execute('SELECT ? AS day, ? AS focal_length, ? AS absent', [
      { kind: 'string', value: '2025-11-27 00:00:00' }, { kind: 'float', value: 80 }, { kind: 'nil' },
    ]);
    assert.deepEqual(completed(await world.dispatch({ op: 'next', id: encoded.id })).value, [['2025-11-27 00:00:00', 80, null]]);
    const object = world.result(inserted.id);
    await world.dispatch({ op: 'close', id: inserted.id });
    assert.equal(object.slots.rows, null);
    assert.equal(object.slots.closed, true);
    await assert.rejects(world.dispatch({ op: 'next', id: inserted.id }), /closed result/);
    await execute('BEGIN');
    await execute('DELETE FROM items');
    await execute('ROLLBACK');
    assert.equal((await execute('SELECT * FROM items')).rowCount.value, '1');
    assert.equal(completed(await world.dispatch({ op: 'schema' })).value[0].columns[0].name, 'id');
  } finally { await world.close(); }
});

test('SQL errors and breakpoints preserve server frames for repair', async () => {
  const world = new ServerWorld(':memory:', { sources, report });
  try {
    const failed = await world.dispatch({ op: 'execute', sql: 'SELECT value FROM missing' });
    assert.equal(failed.process.stop.reason, 'error');
    assert.ok(failed.process.frames.some(frame => frame.selector === 'execute:parameters:'));
    completed(await world.dispatch({ op: 'execute', sql: 'CREATE TABLE missing(value INTEGER)' }));
    await world.dispatch({ op: 'debug', request: { op: 'retry', processId: failed.process.id } });
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const process = world.runtime.process(failed.process.id);
        if (process.status === 'completed') { clearInterval(timer); resolve(); }
        else if (process.stop.reason === 'error') { clearInterval(timer); reject(process.stop.error); }
      }, 5);
    });
    assert.equal((await world.dispatch({ op: 'completion', processId: failed.process.id })).result.rowCount.value, '0');
    const method = world.runtime.classes.get('Database').methods.get('execute:parameters:');
    const point = await world.dispatch({ op: 'debug', request: { op: 'breakpoint', methodId: method.id } });
    const paused = await world.dispatch({ op: 'execute', sql: 'SELECT 42' });
    assert.equal(paused.process.stop.reason, 'breakpoint');
    assert.ok(world.state().processes.some(process => process.id === paused.process.id));
    await world.dispatch({ op: 'debug', request: { op: 'clearBreakpoint', id: point.id } });
    const multi = await world.dispatch({ op: 'execute', sql: 'SELECT 1; CREATE TABLE ignored(x)' });
    assert.match(multi.process.stop.error.message, /one SQL statement/);
    const simultaneous = await Promise.all([world.dispatch({ op: 'schema' }), world.dispatch({ op: 'schema' })]);
    assert.ok(simultaneous.every(response => response.process.status === 'completed'));
  } finally { await world.close(); }
});

test('server inspectors traverse SQL rows without changing the result position', async () => {
  const world = new ServerWorld(':memory:', { sources, report });
  try {
    const result = completed(await world.dispatch({ op: 'execute', sql: 'SELECT 9007199254740993 AS n, NULL AS absent UNION ALL SELECT 7, NULL' })).result;
    const object = world.result(result.id);
    const inspect = request => world.dispatch({ op: 'inspector', ...request });
    const parent = await inspect({ action: 'open', value: world.debugger.value(object) });
    await inspect({ action: 'select', id: parent.id, value: 'slot:rows' });
    const rows = await inspect({ action: 'openSelected', id: parent.id });
    await inspect({ action: 'select', id: rows.id, value: 'property:0' });
    const row = await inspect({ action: 'openSelected', id: rows.id });
    assert.equal(row.fields[1].value.value, '9007199254740993');
    assert.equal(row.fields[2].value.kind, 'nil');
    assert.equal(object.slots.position, 0n);
    world.debugger.releaseAll();
    await inspect({ action: 'close', id: parent.id });
    assert.equal(object.slots.closed, false);
    await world.dispatch({ op: 'close', id: result.id });
    assert.equal((await inspect({ action: 'state', id: row.id })).fields[1].value.value, '9007199254740993');
    await inspect({ action: 'close', id: rows.id });
    await inspect({ action: 'close', id: row.id });
    assert.equal(world.inspectors.sessions.size, 0);
    const database = await inspect({ action: 'open', value: world.debugger.value(world.database) });
    await inspect({ action: 'expression', id: database.id, value: "self execute: 'SELECT 42'" });
    let state = await inspect({ action: 'evaluate', id: database.id, value: 'run' });
    for (let count = 0; count < 100 && state.process.status === 'waiting'; count++) {
      await delay(5);
      state = await inspect({ action: 'state', id: database.id });
    }
    assert.equal(state.process.status, 'completed');
    const inspectedResult = await inspect({ action: 'openResult', id: database.id });
    assert.equal(inspectedResult.className, 'ResultSet');
    assert.equal(inspectedResult.fields.find(field => field.name === 'rowCount').value.value, '1');
  } finally { await world.close(); }
});

test('connections preserve committed writes, roll back on close, and cancel callers', { timeout: 5000 }, async () => {
  const directory = await mkdtemp('/tmp/smallslop-sqlite-test-');
  let world = new ServerWorld(`${directory}/test.sqlite`, { sources, report });
  const execute = async sql => completed(await world.dispatch({ op: 'execute', sql }));
  try {
    await execute('CREATE TABLE saved(value INTEGER)');
    await execute('INSERT INTO saved VALUES (1)');
    await execute('BEGIN');
    await execute('INSERT INTO saved VALUES (2)');
    await world.close();
    world = new ServerWorld(`${directory}/test.sqlite`, { sources, report });
    const result = (await execute('SELECT value FROM saved')).result;
    assert.deepEqual(completed(await world.dispatch({ op: 'next', id: result.id })).value, [[{ kind: 'integer', value: '1' }]]);
    await world.dispatch({ op: 'close', id: result.id });
    const controller = new AbortController();
    const running = world.dispatch({ op: 'execute', sql: 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT max(x) FROM n' }, { signal: controller.signal });
    await delay(20);
    assert.ok(world.state().processes.some(process => process.status === 'waiting'));
    controller.abort();
    assert.equal((await running).process.status, 'cancelled');
    assert.equal(world.results.size, 0);
    const closed = await world.dispatch({ op: 'send', target: 'database', selector: 'close' });
    assert.equal(closed.process.status, 'completed');
    assert.equal(world.connection.closed, true);
  } finally {
    await world.close();
    await rm(directory, { recursive: true, force: true });
  }
});
