import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { acceptWebSocket } from './ws.mjs';
import { ServerWorld } from './world.mjs';
import { ComponentService } from './component-service.mjs';
import { errorData } from '../components/values.js';
import { readPackage, sourceRoot as defaultSourceRoot } from './source-files.mjs';

const loopback = address => address === '::1' || /^(::ffff:)?127\./.test(address);
const remoteError = data => Object.assign(new Error(typeof data?.message === 'string' ? data.message : 'The peer reported an invalid error.'),
  data && typeof data === 'object' ? data : {});

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
};

export function createSmallslopServer({ root, directories, index, databasePath = ':memory:', sourceRoot = defaultSourceRoot, createAgent, components: componentOptions }) {
  const components = componentOptions ? new ComponentService({ ...componentOptions, sourceRoot }) : null;
  const allowed = directories.map(directory => resolve(root, directory) + sep);
  const clients = new Set();
  const validHost = request => {
    const bound = server.address();
    if (!bound) return false;
    const { address, port } = bound;
    const names = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`];
    return !loopback(address) || names.includes(request.headers.host);
  };
  const server = createServer(async (request, response) => {
    try {
      if (!validHost(request)) { response.writeHead(403); response.end('Local host required'); return; }
      const { pathname } = new URL(request.url, 'http://localhost');
      const sources = /^\/api\/smalltalk\/([^/]+)$/.exec(pathname);
      if (request.method !== 'GET') { response.writeHead(405); response.end('GET required'); return; }
      if (sources) {
        const files = await readPackage(sources[1], sourceRoot);
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(files));
        return;
      }
      if (pathname === '/') { response.writeHead(302, { Location: index }); response.end(); return; }
      const decoded = decodeURIComponent(pathname);
      if (decoded.includes('\0')) { response.writeHead(400); response.end('Invalid path'); return; }
      const component = /^\/components\/([a-z][a-z0-9-]*)\/versions\/([a-f0-9]{64})\/(.+)$/.exec(decoded);
      if (component && components?.namespace === component[1]) {
        const type = types[extname(component[3])];
        const source = type && await components.store.source(component[2]);
        if (!source || !Object.hasOwn(source.files, component[3])) { response.writeHead(404); response.end('Not found'); return; }
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        response.end(source.files[component[3]]);
        return;
      }
      const path = resolve(root, `.${decoded}`);
      const type = types[extname(path)];
      if (!type || !allowed.some(prefix => path.startsWith(prefix))) { response.writeHead(404); response.end('Not found'); return; }
      const data = await readFile(path);
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(data);
    } catch (error) {
      const status = error.status ?? (error instanceof URIError ? 400 : ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      response.writeHead(status, { 'Content-Type': 'text/plain' });
      response.end(status === 404 ? 'Not found' : error.message);
    }
  });

  server.on('upgrade', (request, socket) => {
    // Node removes its socket error handler before emitting 'upgrade'.  A
    // peer that resets a rejected connection then needs only cleanup.
    socket.on('error', () => socket.destroy());
    const origin = request.headers.origin;
    if (!validHost(request) || request.url !== '/api/session'
        || (origin && ![`http://${request.headers.host}`, `https://${request.headers.host}`].includes(origin))) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const connection = acceptWebSocket(request, socket);
    if (!connection) return;
    const world = new ServerWorld(databasePath, { sourceRoot });
    const state = { id: randomUUID(), status: 'Ready', model: '', messages: [] };
    const pending = new Map();
    let runner = null;
    let starting = null;
    let busy = false;
    let interrupted = false;
    let closed = false;
    let nextCommand = 1;
    const send = message => { if (!closed) connection.send(JSON.stringify(message)); };
    const publish = () => send({ type: 'status', status: state.status, model: state.model });
    const append = event => {
      const message = { ...event, id: state.messages.length + 1 };
      state.messages.push(message);
      send({ type: 'message', message });
    };
    const requestServer = async (command, signal) => {
      if (signal?.aborted) throw signal.reason;
      return world.dispatch(command, { signal });
    };
    const requestPage = (command, signal, timeout = 30000) => {
      if (closed) return Promise.reject(new Error('The page disconnected.'));
      if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Agent operation cancelled.'));
      const id = `c${nextCommand++}`;
      return new Promise((resolve, reject) => {
        const finish = (error, result) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          pending.delete(id);
          if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(signal.reason ?? new Error('Agent operation cancelled.'));
        const timer = timeout ? setTimeout(() => finish(new Error('The page command timed out.')), timeout) : null;
        pending.set(id, finish);
        signal?.addEventListener('abort', abort, { once: true });
        send({ type: 'command', id, command });
      });
    };
    const page = { send: command => requestPage(command, undefined, 0), connected: () => !closed };
    const getRunner = async () => {
      if (!runner) {
        starting ??= createAgent({ page: requestPage, server: requestServer, onEvent: event => { if (!closed) append(event); } });
        try { runner = await starting; } finally { starting = null; }
        if (closed) { runner.dispose(); throw new Error('The page disconnected.'); }
        state.model = runner.model;
        publish();
      }
      return runner;
    };
    const handle = async message => {
      if (message.type === 'server') {
        const result = await requestServer(message.command);
        send({ type: 'reply', id: message.id, result });
        return;
      }
      if (message.type === 'components') {
        if (!components) throw new Error('This server has no component service.');
        const result = await components.dispatch(message.request, { page });
        send({ type: 'reply', id: message.id, result });
        return;
      }
      if (message.type === 'commandResult') {
        pending.get(message.id)?.(Object.hasOwn(message, 'error') ? remoteError(message.error) : null, message.result);
        return;
      }
      if (message.type === 'interrupt') {
        interrupted = true;
        if (busy) {
          state.status = 'Interrupting';
          publish();
          await runner?.interrupt();
        }
        return;
      }
      if (message.type === 'reset') {
        if (busy) throw new Error('Stop the current turn before resetting the conversation.');
        runner?.dispose();
        runner = null;
        state.messages = [];
        state.status = 'Ready';
        send({ type: 'session', state });
        send({ type: 'reply', id: message.id, result: state });
        return;
      }
      if (message.type !== 'prompt') throw new Error(`Unknown session request: ${message.type}.`);
      if (typeof message.message !== 'string' || !message.message.trim() || message.message.length > 32000) throw new Error('Enter a message of 1 through 32000 characters.');
      if (busy) throw new Error('The agent is running. Stop it or wait for its reply.');
      busy = true;
      interrupted = false;
      state.status = 'Running';
      publish();
      append({ role: 'user', text: message.message, context: message.context });
      try {
        const agent = await getRunner();
        if (!interrupted) await agent.prompt(message.message, message.context);
      } catch (error) {
        if (!interrupted) {
          state.status = 'Error';
          publish();
          append({ role: 'error', text: error.message });
          throw error;
        }
      } finally { busy = false; }
      state.status = interrupted ? 'Interrupted' : 'Ready';
      publish();
      send({ type: 'reply', id: message.id, result: state });
    };
    let disposing;
    const client = { connection, dispose() {
      disposing ??= (async () => {
        closed = true;
        interrupted = true;
        for (const finish of [...pending.values()]) finish(new Error('The page disconnected.'));
        try { await runner?.interrupt(); } finally {
          runner?.dispose();
          try { await components?.disconnect(page); } finally {
            await world.close();
            clients.delete(client);
          }
        }
      })();
      return disposing;
    } };

    clients.add(client);
    connection.onClose = () => { client.dispose().catch(error => server.emit('error', error)); };
    connection.onMessage = text => {
      let message;
      try { message = JSON.parse(text); } catch (error) { send({ type: 'error', error: errorData(error) }); return; }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        send({ type: 'error', error: errorData(new Error('A session request requires an object and a message type.')) });
        return;
      }
      handle(message).catch(error => send({ type: 'reply', id: message.id, error: errorData(error) }));
    };
    send({ type: 'session', state });
  });
  return {
    server, components,
    async close() {
      await Promise.all([...clients].map(async client => { await client.dispose(); client.connection.close(); }));
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await components?.close();
    },
  };
}
