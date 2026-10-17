import inspector from 'node:inspector';
import { ComponentRuntime } from '../components/runtime.js';
import { ComponentStore } from './component-store.mjs';
import { errorData } from '../components/values.js';
import { readPackageSync } from './source-files.mjs';
import { SourceStore } from '../src/sources.js';

const [directory, namespace, incarnation, sourceRoot] = process.argv.slice(2);
const store = new ComponentStore(directory, namespace);
const pending = new Map();
let nextId = 1;
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
const request = message => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  send({ ...message, id }).catch(error => { pending.delete(id); reject(error); });
});
const packages = { kernel: readPackageSync('kernel', sourceRoot), tools: readPackageSync('tools', sourceRoot) };
const runtime = new ComponentRuntime({ namespace, name: 'server', incarnation, sources: packages,
  source: async version => { const source = await store.source(version); return { ...source, loadUrl: source.fileUrl }; },
  remote: value => request({ type: 'request', request: value }),
  changed: event => { send({ type: 'changed', event }).catch(error => { throw error; }); },
});
const sources = new SourceStore({ runtime: runtime.runtime, packages, label: 'server component runtime',
  report: error => { send({ type: 'report', error: errorData(error) }).catch(sendError => { throw sendError; }); } });
sources.attach((packageName, file, text, version) => request({ type: 'source.write', packageName, file, text, version }));

process.on('message', message => {
  if (message.type === 'result') {
    const pendingRequest = pending.get(message.id);
    if (!pendingRequest) return;
    pending.delete(message.id);
    if (message.error) pendingRequest.reject(Object.assign(new Error(message.error.message), message.error));
    else pendingRequest.resolve(message.result);
    return;
  }
  if (message.type === 'source') {
    sources.receive(message.update);
    return;
  }
  if (message.type !== 'request') return;
  Promise.resolve().then(() => runtime.dispatch(message.request)).then(
    result => send({ type: 'result', id: message.id, result }),
    error => send({ type: 'result', id: message.id, error: errorData(error) }),
  ).catch(error => { throw error; });
});

inspector.open(0, '127.0.0.1', false);
if (!inspector.url()) throw new Error('The component runtime could not open its Node inspector listener.');
await send({ type: 'ready', identity: runtime.identity, inspectorUrl: inspector.url(), sources: sources.versions() });

process.on('disconnect', () => { inspector.close(); process.exit(0); });
