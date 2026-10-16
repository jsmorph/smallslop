import inspector from 'node:inspector';
import { ComponentRuntime } from '../components/runtime.js';
import { ComponentStore } from './component-store.mjs';
import { errorData } from '../components/values.js';
import { readPackageSync } from './source-files.mjs';

const [directory, namespace, incarnation, sourceRoot] = process.argv.slice(2);
const store = new ComponentStore(directory, namespace);
const pending = new Map();
let nextId = 1;
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
const runtime = new ComponentRuntime({ namespace, name: 'server', incarnation, sources: { kernel: readPackageSync('kernel', sourceRoot), tools: readPackageSync('tools', sourceRoot) },
  source: async version => { const source = await store.source(version); return { ...source, loadUrl: source.fileUrl }; },
  remote: request => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ type: 'request', id, request }).catch(error => { pending.delete(id); reject(error); });
  }),
  changed: event => { send({ type: 'changed', event }).catch(error => { throw error; }); },
});
inspector.open(0, '127.0.0.1', false);
if (!inspector.url()) throw new Error('The component runtime could not open its Node inspector listener.');
await send({ type: 'ready', identity: runtime.identity, inspectorUrl: inspector.url() });

process.on('message', message => {
  if (message.type === 'result') {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
    else request.resolve(message.result);
    return;
  }
  if (message.type !== 'request') return;
  Promise.resolve().then(() => runtime.dispatch(message.request)).then(
    result => send({ type: 'result', id: message.id, result }),
    error => send({ type: 'result', id: message.id, error: errorData(error) }),
  ).catch(error => { throw error; });
});

process.on('disconnect', () => { inspector.close(); process.exit(0); });
