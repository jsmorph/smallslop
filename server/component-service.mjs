import path from 'node:path';
import { ComponentStore } from './component-store.mjs';
import { ComponentProcess } from './component-process.mjs';
import { CdpConnection, JavaScriptDebugger } from './debug-connection.mjs';
import { ComponentRequests } from '../components/requests.js';
import { describeComponentJob } from '../components/jobs.js';
import { referenceKey, validateReference } from '../components/values.js';

export class ComponentService {
  constructor({ directory, namespace, maxActive = 256, maxCompleted = 1024 }) {
    if (typeof namespace !== 'string' || !/^[a-z][a-z0-9-]*$/.test(namespace)) throw new Error('A component namespace requires lowercase letters, digits, and hyphens.');
    this.store = new ComponentStore(path.resolve(directory), namespace);
    this.namespace = namespace;
    this.requests = new ComponentRequests({ maxActive, maxCompleted });
    this.browsers = new Map();
    this.instances = new Map();
    this.progress = new Map();
    this.jobs = new Map();
    this.process = null;
  }

  server() {
    if (!this.process) this.process = new ComponentProcess({ directory: this.store.directory, namespace: this.namespace,
      remote: request => this.invoke(request), changed: event => {
        if (event.type === 'instance') this.instances.set(referenceKey(event.reference), event);
        if (event.type === 'call') {
          this.progress.get(event.id)?.(event);
          if (event.job) { this.jobs.set(event.id, event); this.trimJobs(); }
        }
        if (event.type === 'call-released' && this.jobs.has(event.id)) this.jobs.get(event.id).released = true;
      }, failed: error => {
        for (const call of this.jobs.values()) if (describeComponentJob(call).active) {
          call.unavailable = true; call.error = { message: error.message }; call.updatedAt = new Date().toISOString();
        }
      } });
    return this.process;
  }

  listJobs() { return [...this.jobs.values()].map(describeComponentJob); }

  job(id) {
    const call = this.jobs.get(id);
    if (!call) throw new Error('Component job is unavailable or its history has expired.');
    return call;
  }

  trimJobs() {
    for (const call of this.jobs.values()) {
      if (this.jobs.size <= 64) break;
      if (!describeComponentJob(call).active) this.jobs.delete(call.id);
    }
  }

  describe() {
    return { namespace: this.namespace, incarnation: this.requests.incarnation,
      limits: { messageBytes: 1024 * 1024, activeRequests: this.requests.maxActive, completedRequests: this.requests.maxCompleted },
      runtimes: [{ runtime: 'server', incarnation: this.process?.identity.incarnation ?? null,
        status: this.process?.error ? 'unavailable' : this.process ? 'running' : 'stopped',
        javascriptDebugger: this.process?.debugger?.state() ?? { available: false } },
      ...[...this.browsers.values()].map(browser => ({ ...browser.identity,
        status: browser.page.connected() ? 'connected' : 'disconnected',
        javascriptDebugger: browser.debugger?.state() ?? { available: false } }))] };
  }

  pageRuntime(page) { return [...this.browsers.values()].find(browser => browser.page === page)?.identity; }

  async register({ identity, page }) {
    if (!page) throw new Error('A browser runtime requires a connected page.');
    if (!identity || identity.namespace !== this.namespace || !identity.runtime?.startsWith('browser-') || typeof identity.incarnation !== 'string') throw new Error('Invalid browser component runtime.');
    for (const [name, browser] of this.browsers) if (browser.page === page && name !== identity.runtime) await this.removeBrowser(name);
    const previous = this.browsers.get(identity.runtime);
    if (previous && (previous.page !== page || previous.identity.incarnation !== identity.incarnation)) throw new Error('Browser runtime identity is already registered.');
    this.browsers.set(identity.runtime, previous ?? { identity, page, debugger: null });
    return this.describe();
  }

  async disconnect(page) {
    for (const [name, browser] of this.browsers) if (browser.page === page) await this.removeBrowser(name);
  }

  async removeBrowser(name) {
    const browser = this.browsers.get(name);
    this.browsers.delete(name);
    for (const instance of this.instances.values()) if (instance.reference.runtime === name) instance.status = 'unavailable';
    await browser.debugger?.close();
  }

  submit(request, { page, id = this.requests.reserve().id } = {}) {
    const pageRuntime = page ? this.pageRuntime(page) : undefined;
    const captured = { ...request, ...(pageRuntime ? { pageRuntime } : {}) };
    if (captured.runtime === 'page') {
      if (!pageRuntime) throw new Error('The page has no registered component runtime.');
      captured.runtime = pageRuntime.runtime;
    }
    return this.requests.submit(id, captured, (request, id, progress) => this.run(request, id, progress));
  }

  async invoke(request, options) {
    let state = this.submit(request, options);
    while (state.status === 'running') state = await this.requests.wait(state.id, state.revision);
    if (state.error) throw Object.assign(new Error(state.error.message), state.error, { requestId: state.id, outcomeUnknown: state.status === 'unknown' });
    return state.result;
  }

  async dispatch(request, { page } = {}) {
    switch (request.op) {
      case 'runtimes.describe': return this.describe();
      case 'runtimes.register': return this.register({ identity: request.identity, page });
      case 'requests.reserve': return this.requests.reserve();
      case 'requests.inspect': return this.requests.inspect(request.id);
      case 'requests.wait': return this.requests.wait(request.id, request.revision);
      case 'requests.release': return this.requests.release(request.id);
      case 'requests.submit': return this.submit(request.request, { id: request.id, page });
      case 'modules.list': return this.store.list();
      case 'modules.source': return this.store.source(request.version);
      case 'snapshots.read': return this.store.snapshot(request.id);
      case 'snapshots.list': return this.store.snapshots();
      case 'jobs.list': return this.listJobs();
      case 'jobs.inspect': return describeComponentJob(this.job(request.id));
      case 'debug.javascript': return this.javascript({ ...request, runtime: request.runtime === 'page' ? this.pageRuntime(page)?.runtime : request.runtime });
      default: return this.submit(request, { page });
    }
  }

  async run(request, id, progress) {
    if (request.op === 'modules.install') return this.store.install(request);
    if (request.op === 'jobs.cancel') {
      const call = this.job(request.id);
      if (!describeComponentJob(call).canCancel) throw new Error('The component job cannot be cancelled in its current state.');
      const result = await this.run({ op: 'calls.cancel', target: call.target, id: call.id }, id, progress);
      return describeComponentJob(result);
    }
    if (request.op === 'jobs.start' && request.target?.runtime !== 'server') throw new Error('Component jobs require a server instance.');
    if (request.op === 'objects.create' && request.snapshot) {
      const saved = await this.store.snapshot(request.snapshot);
      if (['version', 'configuration', 'state'].some(name => Object.hasOwn(request, name))) throw new Error('A snapshot supplies its source version, configuration, and state.');
      request = { ...request, version: saved.version, configuration: saved.configuration,
        ...(saved.state === undefined ? {} : { state: saved.state }), savedSnapshot: saved.id };
    }
    if (request.op === 'objects.save') {
      const captured = await this.run({ ...request, op: 'objects.snapshot' }, id, progress);
      const saved = await this.store.saveSnapshot(captured);
      return this.run({ ...request, op: 'objects.saved', snapshot: saved.id, expectedRevision: captured.revision,
        source: { manifest: captured.manifest, files: captured.files } }, id, progress);
    }
    if (request.op === 'debug.attach') return this.attach(request);
    if (request.op === 'debug.detach') {
      const browser = this.browsers.get(request.runtime);
      if (!browser?.debugger) throw new Error('The browser has no attached debugger.');
      await browser.debugger.close(); browser.debugger = null;
      return this.describe();
    }
    if (request.op === 'runtimes.restart') {
      if (!this.process || request.expectedIncarnation !== this.process.identity.incarnation) throw new Error('Server runtime incarnation conflict.');
      await this.process.close(); this.process = null;
      for (const instance of this.instances.values()) if (instance.reference.runtime === 'server') instance.status = 'unavailable';
      await this.server().ready;
      return this.describe();
    }
    let name = request.runtime ?? request.target?.runtime;
    if (!name && request.version) {
      const source = await this.store.source(request.version);
      name = source.manifest.target === 'server' ? 'server' : request.pageRuntime?.runtime;
    }
    if (!name) throw new Error('Select a component runtime or target reference.');
    if (request.target) {
      validateReference(request.target);
      if (request.target.namespace !== this.namespace || request.op !== 'panes.inspect' && request.target.runtime !== name) throw new Error('Component target differs from the selected namespace or runtime.');
    }
    if (['objects.dispose', 'objects.consumers'].includes(request.op)) {
      for (const browser of this.browsers.values()) {
        if (browser.page.connected()) {
          const instances = await browser.page.send({ op: 'componentRuntime', identity: browser.identity, request: { op: 'objects.list' } });
          for (const instance of instances) this.instances.set(referenceKey(instance.reference), instance);
        }
      }
      const consumers = [...this.instances.values()].filter(instance => !['disposed', 'unavailable'].includes(instance.status)
        && referenceKey(instance.reference) !== referenceKey(request.target)
        && Object.values(instance.bindings ?? {}).some(binding => referenceKey(binding.target) === referenceKey(request.target)));
      if (request.op === 'objects.consumers') return consumers;
      if (consumers.length) throw new Error(`Component has consumers: ${consumers.map(instance => instance.reference.id).join(', ')}.`);
    }
    const command = ['objects.send', 'objects.create', 'jobs.start'].includes(request.op) ? { ...request, id: request.id ?? id } : request;
    this.progress.set(id, progress);
    try {
      let result;
      if (name === 'server') result = await this.server().dispatch(command);
      else {
        const browser = this.browsers.get(name);
        if (!browser || request.op !== 'panes.inspect' && request.target && request.target.incarnation !== browser.identity.incarnation
            || request.pageRuntime?.runtime === name && request.pageRuntime.incarnation !== browser.identity.incarnation) throw new Error('Browser runtime is unavailable.');
        try { result = await browser.page.send({ op: 'componentRuntime', identity: browser.identity, request: command }); }
        catch (error) {
          if (!browser.page.connected()) error.outcomeUnknown = true;
          throw error;
        }
      }
      if (result?.reference && result.bindings) this.instances.set(referenceKey(result.reference), result);
      if (request.op === 'objects.list') for (const instance of result) this.instances.set(referenceKey(instance.reference), instance);
      if (request.op === 'jobs.start') return describeComponentJob(result);
      return result;
    } finally { this.progress.delete(id); }
  }

  async javascript(request) {
    let debugger_;
    if (request.runtime === 'server') {
      const process = this.server(); await process.ready;
      if (request.incarnation && request.incarnation !== process.identity.incarnation) throw new Error('Server debugger incarnation conflict.');
      debugger_ = process.debugger;
    } else debugger_ = this.browsers.get(request.runtime)?.debugger;
    if (!debugger_) throw new Error('Attach the JavaScript debugger for this runtime first.');
    return debugger_.dispatch(request);
  }

  async attach({ runtime, endpoint, targetId, incarnation }) {
    const browser = this.browsers.get(runtime);
    if (!browser || browser.identity.incarnation !== incarnation) throw new Error('Browser debugger incarnation conflict.');
    if (browser.debugger) throw new Error('A debugger is already attached to this browser runtime.');
    if (typeof endpoint !== 'string' || typeof targetId !== 'string') throw new Error('Browser debugging requires an endpoint and target ID.');
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/json/version`);
    if (!response.ok) throw new Error(`Browser debugger endpoint returned HTTP ${response.status}.`);
    const version = await response.json();
    const connection = new CdpConnection(version.webSocketDebuggerUrl);
    try {
      const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
      const check = await connection.send('Runtime.evaluate', { expression: 'globalThis.smallslopComponents?.identity', returnByValue: true }, sessionId);
      const identity = check.result.value;
      if (!identity || ['namespace', 'runtime', 'incarnation'].some(key => identity[key] !== browser.identity[key])) throw new Error('Browser debugger target differs from the requested component runtime.');
      const debugger_ = new JavaScriptDebugger(connection, { sessionId, sourceFilter: url => url.includes(`/components/${this.namespace}/versions/`) });
      await debugger_.enable();
      browser.debugger = debugger_;
      return debugger_.state();
    } catch (error) { await connection.close(); throw error; }
  }

  async close() {
    const outcomes = await Promise.allSettled([this.process?.close(), ...[...this.browsers.values()].map(browser => browser.debugger?.close())]);
    const errors = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
    if (errors.length) throw new AggregateError(errors, 'Component service cleanup failed.');
  }
}
