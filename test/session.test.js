import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer, request as httpRequest } from 'node:http';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createSmallslopServer } from '../server/server.mjs';
import { SessionConnection } from '../ui/session-connection.js';
import { acceptWebSocket } from '../server/ws.mjs';
import { sourceRoot } from '../server/source-files.mjs';

const root = path.resolve(import.meta.dirname, '..');

async function start(options = {}) {
  const app = createSmallslopServer({ root, directories: ['src'], index: '/src/index.js', ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, port: app.server.address().port };
}

function status(port, target) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: target }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

function connect(port, options = {}) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const connection = new SessionConnection({ url: `ws://127.0.0.1:${port}/api/session`, command: () => null, session: () => {},
    error: () => {}, open: () => resolve(connection), ...options });
  connection.connect();
  connection.socket.addEventListener('error', () => reject(new Error('The test connection failed.')), { once: true });
  return promise;
}

async function rawSocket(port) {
  const socket = net.connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`GET /api/session HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
    + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  const received = [];
  socket.on('data', chunk => received.push(chunk));
  const ended = once(socket, 'close');
  const until = async predicate => {
    const deadline = Date.now() + 5000;
    while (!predicate(Buffer.concat(received))) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the server.');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  await until(data => data.includes('\r\n\r\n'));
  return { socket, received, ended, until };
}

function frame(opcode, payload, { mask = true, declaredLength = payload.length } = {}) {
  const header = declaredLength < 126 ? Buffer.from([0x80 | opcode, (mask ? 0x80 : 0) | declaredLength])
    : Buffer.concat([Buffer.from([0x80 | opcode, (mask ? 0x80 : 0) | 127]), (() => { const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(declaredLength)); return length; })()]);
  if (!mask) return Buffer.concat([header, payload]);
  const key = Buffer.from([1, 2, 3, 4]);
  return Buffer.concat([header, key, Buffer.from(payload.map((byte, index) => byte ^ key[index % 4]))]);
}

function closeCode(data) {
  let offset = data.indexOf('\r\n\r\n') + 4;
  while (offset + 2 <= data.length) {
    let length = data[offset + 1] & 0x7f;
    let start = offset + 2;
    if (length === 126) { length = data.readUInt16BE(start); start += 2; }
    else if (length === 127) { length = Number(data.readBigUInt64BE(start)); start += 8; }
    if ((data[offset] & 0x0f) === 0x8) return length >= 2 ? data.readUInt16BE(start) : null;
    offset = start + length;
  }
  return null;
}

test('rejected upgrades survive connection resets', { timeout: 10000 }, async () => {
  const { app, port } = await start();
  try {
    for (let index = 0; index < 50; index++) {
      const socket = net.connect(port, '127.0.0.1');
      await once(socket, 'connect');
      socket.write(`GET /other HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
        + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
      socket.resetAndDestroy();
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await status(port, '/src/index.js'), 200);
  } finally { await app.close(); }
});

test('the server answers file requests with exact statuses', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-session-'));
  const { app, port } = await start({ components: { directory, namespace: 'test' } });
  try {
    const installed = await app.components.invoke({ op: 'modules.install', files: { 'index.mjs': 'export function create() { return {}; }' },
      manifest: { name: 'empty', target: 'browser', interface: { className: 'Empty' } } });
    assert.equal(await status(port, installed.url), 200);
    assert.equal(await status(port, `/components/test/versions/${installed.version}/missing.mjs`), 404);
    assert.equal(await status(port, `/components/test/versions/${installed.version}/manifest.json`), 404);
    assert.equal(await status(port, `/components/test/versions/${'0'.repeat(64)}/index.mjs`), 404);
    assert.equal(await status(port, '/src/a%00.js'), 400);
    assert.equal(await status(port, '/src/%E0%A4%A.js'), 400);
    assert.equal(await status(port, '/src/%2e%2e/package.json'), 404);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('WebSocket frames are limited, masked, and ignored after close', { timeout: 10000 }, async () => {
  const { app, port } = await start();
  try {
    const large = await rawSocket(port);
    large.socket.write(frame(0x1, Buffer.alloc(0), { declaredLength: 3 * 1024 * 1024 }));
    await large.ended;
    assert.equal(closeCode(Buffer.concat(large.received)), 1009);

    const unmasked = await rawSocket(port);
    unmasked.socket.write(frame(0x1, Buffer.from('{}'), { mask: false }));
    await unmasked.ended;
    assert.equal(closeCode(Buffer.concat(unmasked.received)), 1002);

    const closing = await rawSocket(port);
    closing.socket.write(Buffer.concat([frame(0x8, Buffer.alloc(0)),
      frame(0x1, Buffer.from(JSON.stringify({ type: 'server', id: 'r1', command: { op: 'state' } })))]));
    await closing.ended;
    assert.equal(Buffer.concat(closing.received).includes('"reply"'), false);
  } finally { await app.close(); }
});

test('the session protocol sends entries one at a time and structured errors', { timeout: 10000 }, async () => {
  let page;
  const createAgent = options => {
    page = options.page;
    return { model: 'test/fixture', async prompt(message) {
      options.onEvent({ role: 'assistant', text: `Reply to ${message}.` });
    }, interrupt: async () => {}, dispose() {} };
  };
  const { app, port } = await start({ createAgent });
  try {
    const types = [];
    const states = [];
    const connection = await connect(port, {
      session: state => states.push(structuredClone(state)),
      command: command => {
        if (command.op === 'fields') throw Object.assign(new Error('Replacement failed.'), { phase: 'committed' });
        if (command.op === 'string') throw 'A thrown string.';
        return { answered: command.op };
      },
    });
    connection.socket.addEventListener('message', event => types.push(JSON.parse(event.data).type));
    const result = await connection.ask('first', {});
    assert.deepEqual(result.messages.map(entry => entry.text), ['first', 'Reply to first.']);
    assert.deepEqual(states.at(-1).messages.map(entry => entry.text), ['first', 'Reply to first.']);
    assert.ok(types.filter(type => type === 'session').length <= 1);
    assert.ok(types.filter(type => type === 'message').length === 2 && types.includes('status'));
    assert.deepEqual(await page({ op: 'plain' }), { answered: 'plain' });
    await assert.rejects(page({ op: 'fields' }), error => error.message === 'Replacement failed.' && error.phase === 'committed');
    await assert.rejects(page({ op: 'string' }), error => error.message === 'A thrown string.');
    await assert.rejects(connection.server({ op: 'unknown' }), error => error.name === 'Error' && /Unknown server command/.test(error.message));
    connection.socket.close();
  } finally { await app.close(); }
});

test('page command results stay on the socket that delivered the command', { timeout: 10000 }, async () => {
  const pages = [];
  const createAgent = options => {
    pages.push(options.page);
    return { model: 'test/fixture', prompt: async () => {}, interrupt: async () => {}, dispose() {} };
  };
  const { app, port } = await start({ createAgent });
  try {
    const slow = Promise.withResolvers();
    const received = Promise.withResolvers();
    const connection = await connect(port, {
      command: command => {
        if (command.op !== 'slow') return command.op;
        received.resolve();
        return slow.promise;
      },
    });
    await connection.ask('start', {});
    const first = pages[0]({ op: 'slow' });
    await received.promise;
    const reopened = Promise.withResolvers();
    connection.open = reopened.resolve;
    connection.socket.close();
    await assert.rejects(first, /page disconnected/);
    connection.connect();
    await reopened.promise;
    await connection.ask('start', {});
    const second = pages[1]({ op: 'fast' });
    slow.resolve('stale result');
    assert.equal(await second, 'fast');
    connection.socket.close();
  } finally { await app.close(); }
});

test('a page runtime registers again from a new connection', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-session-'));
  const { app, port } = await start({ components: { directory, namespace: 'test' } });
  const identity = { namespace: 'test', runtime: 'browser-reconnect', incarnation: 'one' };
  try {
    const first = await connect(port);
    await first.components({ op: 'runtimes.register', identity });
    const second = await connect(port);
    await second.components({ op: 'runtimes.register', identity });
    first.socket.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    const browser = (await second.components({ op: 'runtimes.describe' })).runtimes.find(runtime => runtime.runtime === identity.runtime);
    assert.equal(browser.status, 'connected');
    const other = await connect(port);
    await assert.rejects(other.components({ op: 'runtimes.register', identity: { ...identity, incarnation: 'two' } }), /already registered/);
    for (const connection of [second, other]) connection.socket.close();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a connection whose unsent output exceeds its limit closes', { timeout: 10000 }, async () => {
  const server = createServer();
  const accepted = Promise.withResolvers();
  const closed = Promise.withResolvers();
  server.on('upgrade', (request, socket) => {
    const connection = acceptWebSocket(request, socket, { maxBufferedBytes: 64 * 1024 });
    connection.onClose = closed.resolve;
    accepted.resolve(connection);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = net.connect(server.address().port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    socket.pause();
    socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
    const connection = await accepted.promise;
    const text = 'x'.repeat(64 * 1024);
    for (let index = 0; index < 1000 && !connection.closed; index++) connection.send(text);
    await closed.promise;
    assert.equal(connection.closed, true);
  } finally {
    socket.destroy();
    server.close();
  }
});

test('the page receives source file errors from its server runtime', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smallslop-root-'));
  await cp(sourceRoot, directory, { recursive: true });
  const { app, port } = await start({ sourceRoot: directory });
  const { promise: reported, resolve } = Promise.withResolvers();
  try {
    const connection = await connect(port, { error: resolve });
    await writeFile(path.join(directory, 'kernel', 'Integer.st'), 'edited elsewhere');
    await connection.server({ op: 'debug', request: { op: 'install', className: 'Integer', source: 'doubledForTest ^self * 2' } });
    assert.equal((await reported).message, "kernel/Integer.st changed after the server runtime read it.  The server runtime's changes to Integer are not saved.  Reload the page to load the current file.");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
