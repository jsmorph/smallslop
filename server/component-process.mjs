import { fork } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CdpConnection, JavaScriptDebugger } from './debug-connection.mjs';
import { errorData } from '../components/values.js';
import { sourceRoot as defaultSourceRoot } from './source-files.mjs';

export class ComponentProcess {
  constructor({ directory, namespace, sourceRoot = defaultSourceRoot, remote, changed = () => {}, failed = () => {} }) {
    this.identity = { namespace, runtime: 'server', incarnation: crypto.randomUUID() };
    const versions = `${pathToFileURL(path.join(directory, 'versions')).href}/`;
    this.pending = new Map();
    this.nextId = 1;
    this.error = null;
    this.debugger = null;
    this.child = fork(new URL('./component-child.mjs', import.meta.url), [directory, namespace, this.identity.incarnation, sourceRoot], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [],
    });
    const ready = Promise.withResolvers();
    this.ready = ready.promise;
    const fail = error => {
      if (this.error) return;
      this.error = error;
      failed(error);
      ready.reject(error);
      for (const pending of this.pending.values()) pending.reject(Object.assign(new Error(error.message), { outcomeUnknown: true }));
      this.pending.clear();
    };
    this.child.on('error', fail);
    this.child.on('exit', (code, signal) => fail(new Error(`Component runtime exited: ${signal ?? code}.`)));
    this.child.on('message', message => {
      if (message.type === 'ready') {
        this.inspectorUrl = message.inspectorUrl;
        try {
          this.debugger = new JavaScriptDebugger(new CdpConnection(message.inspectorUrl), { sourceFilter: url => url.startsWith(versions) });
          this.debugger.enable().then(() => ready.resolve(this.identity), fail);
        } catch (error) { fail(error); }
      } else if (message.type === 'changed') changed(message.event);
      else if (message.type === 'result') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message), message.error));
        else pending.resolve(message.result);
      } else if (message.type === 'request') {
        Promise.resolve().then(() => remote(message.request)).then(
          result => this.send({ type: 'result', id: message.id, result }),
          error => this.send({ type: 'result', id: message.id, error: errorData(error) }),
        ).catch(fail);
      }
    });
  }

  send(message) {
    return new Promise((resolve, reject) => this.child.send(message, error => error ? reject(error) : resolve()));
  }

  async dispatch(request) {
    await this.ready;
    if (this.error) throw this.error;
    if (request.target && request.target.incarnation !== this.identity.incarnation) throw new Error('Object belongs to an unavailable server runtime incarnation.');
    if (request.expectedIncarnation && request.expectedIncarnation !== this.identity.incarnation) throw new Error('Server runtime incarnation conflict.');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'request', id, request }).catch(error => { this.pending.delete(id); reject(error); });
    });
  }

  async close() {
    await this.debugger?.close();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise(resolve => this.child.once('exit', resolve));
    this.child.kill('SIGTERM');
    await exited;
  }
}
