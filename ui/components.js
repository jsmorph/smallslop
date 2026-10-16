import { ComponentRuntime } from '../components/runtime.js';
import { ComponentClient } from '../components/client.js';
import { referenceKey, errorData } from '../components/values.js';
import { element } from './pane-view.js';

export function createWorkspaceComponents({ workspace, development, request, namespace }) {
  const { world, report } = workspace;
  const panes = new Map();
  let refreshList = () => {};
  const client = new ComponentClient(request);
  const run = request => client.run(request);
  const runtime = new ComponentRuntime({ namespace, name: `browser-${crypto.randomUUID()}`, host: world.host, debugger: world.debugger,
    source: async version => {
      const source = await request({ op: 'modules.source', version });
      return { ...source, loadUrl: new URL(source.url, location.href).href };
    },
    remote: run,
    failed: report,
    changed: () => refreshList(),
  });
  globalThis.smallslopComponents = { identity: runtime.identity };

  function describePane(record) {
    const pane = world.require(record.id);
    return { id: record.id, target: record.target, revision: record.revision,
      title: pane.object.slots.title, bounds: world.rectangle(pane), visible: pane.object.slots.visible, association: pane.association ?? null };
  }

  function view(instance, id) {
    return async body => {
      if (instance.mounted || instance.mounting) throw new Error('The component already owns a mounted or preparing view.');
      if (typeof instance.object?.mount !== 'function') throw new Error('The component has no mount method.');
      instance.mounting = true;
      try { await instance.scope.task(Promise.resolve().then(() => instance.object.mount(body))); }
      catch (error) { instance.error = errorData(error); runtime.notify(instance); throw error; }
      finally { instance.mounting = false; }
      instance.mounted = id;
      return {
        state: () => runtime.describe(instance),
        visibility(shown) {
          if (!instance.object?.visibility) return;
          return instance.scope.task(Promise.resolve().then(() => instance.object.visibility(shown))).catch(error => {
            instance.error = errorData(error); runtime.notify(instance); throw error;
          });
        },
        dispose() { if (instance.mounted === id) instance.mounted = null; },
      };
    };
  }

  async function open({ target, title, bounds, association, id = `component-${crypto.randomUUID()}` }) {
    const instance = runtime.get(target);
    if (instance.status !== 'ready') throw new Error(`Component is ${instance.status}.`);
    if (instance.mounting) throw new Error('The component is preparing a view.');
    if (instance.mounted) {
      world.send(instance.mounted, 'open');
      await world.require(instance.mounted).view.ready();
      return describePane(panes.get(instance.mounted));
    }
    if (world.panes.has(id)) throw new Error(`Pane already exists: ${id}.`);
    const record = { id, target: instance.reference, revision: 0 };
    const pane = workspace.add({ id, title: title ?? instance.module.source.manifest.interface.className, bounds, association,
      owner: instance.wrapper, description: `Installed component ${instance.module.source.manifest.name}.`, create: view(instance, id), open: true });
    panes.set(id, record);
    try { await pane.view.ready(); }
    catch (error) {
      panes.delete(id);
      await world.remove(id);
      refreshList();
      throw error;
    }
    refreshList();
    return describePane(record);
  }

  async function replace({ id, target, expectedRevision, expectedTarget }) {
    const record = panes.get(id);
    if (!record) throw new Error('Unknown component pane.');
    const previous = runtime.get(record.target);
    const candidate = runtime.get(target);
    if (candidate.status !== 'ready' || candidate.mounted) throw new Error('Replacement requires a ready, unmounted component.');
    const check = () => {
      if (record.discarding) throw new Error('The component pane is being discarded.');
      if (panes.get(id) !== record || record.revision !== expectedRevision || referenceKey(record.target) !== referenceKey(expectedTarget)) throw new Error('Component pane revision conflict.');
      runtime.assertIdle(previous); runtime.assertIdle(candidate);
    };
    check();
    await world.require(id).view.replace(view(candidate, id), check, () => {
      record.target = candidate.reference; record.revision++;
      world.require(id).object.slots.owner = candidate.wrapper;
      refreshList();
    });
    return describePane(record);
  }

  async function discard({ id, expectedRevision }) {
    const record = panes.get(id);
    if (!record) throw new Error('Unknown component pane.');
    if (record.discarding) throw new Error('The component pane is being discarded.');
    if (record.revision !== expectedRevision) throw new Error('Component pane revision conflict.');
    const instance = runtime.get(record.target);
    if (instance.mounted !== id) throw new Error('The pane does not hold its component view.');
    runtime.assertIdle(instance);
    record.discarding = true;
    try {
      instance.mounted = null;
      try { await runtime.dispose(record.target); }
      catch (error) { instance.mounted = id; throw error; }
      await world.remove(id);
      panes.delete(id); refreshList();
      return { discarded: id };
    } finally { record.discarding = false; }
  }

  async function inspect(target) {
    if (runtime.local(target)) return development.inspect(runtime.get(target).wrapper);
    const server = value => run({ ...value, op: value.op === 'debug' ? 'debug.smallslop' : value.op,
      runtime: target.runtime, target: undefined, expectedIncarnation: target.incarnation });
    const snapshot = await run({ op: 'objects.inspector', target });
    return development.remoteInspector(snapshot, server);
  }

  function execute(value) {
    switch (value.op) {
      case 'panes.open': return open(value);
      case 'panes.replace': return replace(value);
      case 'panes.discard': return discard(value);
      case 'panes.list': return [...panes.values()].map(describePane);
      case 'panes.inspect': return inspect(value.target);
      default: return runtime.dispatch(value);
    }
  }

  workspace.add({ id: 'components', title: 'Components', description: 'Installed JavaScript instances, versions, calls, and source.',
    bounds: { x: 140, y: 80, width: 680, height: 520 },
    create(body, { on }) {
      body.classList.add('pane-content');
      const content = element('div');
      const expanded = new Set();
      body.append(content);
      const focusKey = node => node?.dataset?.action && [node.closest('[data-component]')?.dataset.component,
        node.closest('[data-call]')?.dataset.call ?? '', node.dataset.action, node.dataset.binding ?? ''].join(' ');
      refreshList = () => {
        const focused = content.contains(document.activeElement) ? focusKey(document.activeElement) : null;
        content.replaceChildren();
        for (const instance of runtime.instances.values()) {
          const state = runtime.describe(instance);
          const row = element('article', undefined, 'workspace-record');
          row.dataset.component = state.reference.id;
          row.append(element('h3', state.className), element('p', `${state.status} · ${state.workspace ? 'Workspace object' : state.version.slice(0, 12)}`));
          if (state.error) row.append(element('p', state.error.message, 'pane-error'));
          if (state.savedSnapshot) row.append(element('p', `Saved ${state.savedSnapshot.slice(0, 12)}`));
          const actions = element('div', undefined, 'pane-actions');
          for (const [action, label] of [['inspect', 'Inspect'], ['show', 'Show'], ['methods', 'Methods'], ['source', 'JavaScript'], ['save', 'Save'], ['export', 'Export source']]) {
            const button = element('button', label); button.dataset.action = action;
            if (action === 'show') button.disabled = !state.pane;
            if (['source', 'save', 'export'].includes(action)) button.disabled = !!state.workspace || state.status !== 'ready';
            actions.append(button);
          }
          row.append(actions);
          for (const name of Object.keys(state.bindings)) {
            const button = element('button', `Inspect ${name}`);
            button.dataset.action = 'binding'; button.dataset.binding = name;
            row.append(button);
          }
          const calls = [...runtime.calls.values()].filter(call => call.target.id === instance.id);
          if (calls.length) {
            const details = element('details'); details.dataset.key = `${instance.id}:calls`;
            details.open = expanded.has(details.dataset.key);
            details.append(element('summary', `Calls (${calls.length})`));
            for (const call of calls) {
              const entry = element('div'); entry.dataset.call = call.id;
              entry.append(element('span', `${call.selector}: ${call.status}${call.error ? `: ${call.error.message}` : ''} `));
              const button = element('button', 'Debug'); button.dataset.action = 'debug'; entry.append(button);
              if (['completed', 'cancelled'].includes(call.status) && call.execution !== 'running') {
                const release = element('button', 'Release'); release.dataset.action = 'release'; entry.append(release);
              }
              details.append(entry);
            }
            row.append(details);
          }
          content.append(row);
        }
        if (!content.children.length) content.append(element('p', 'No installed component instances in this page.'));
        if (focused) [...content.querySelectorAll('button[data-action]')].find(button => focusKey(button) === focused)?.focus();
      };
      on(content, 'click', event => {
        const summary = event.target.closest('summary');
        if (summary) {
          const key = summary.parentElement.dataset.key;
          if (summary.parentElement.open) expanded.delete(key); else expanded.add(key);
          return;
        }
        const button = event.target.closest('button[data-action]');
        const id = button?.closest('[data-component]')?.dataset.component;
        if (!id) return;
        Promise.resolve().then(async () => {
          const instance = runtime.instances.get(id);
          if (button.dataset.action === 'inspect') return inspect(instance.reference);
          if (button.dataset.action === 'show') return world.send(instance.mounted, 'open');
          if (button.dataset.action === 'binding') return inspect(instance.bindings[button.dataset.binding].target);
          const callId = button.closest('[data-call]')?.dataset.call;
          if (button.dataset.action === 'release') return runtime.dispatch({ op: 'calls.release', id: callId });
          if (button.dataset.action === 'debug') {
            const call = await runtime.dispatch({ op: 'calls.retain', id: callId });
            world.send('debugger', 'open');
            const detail = await world.require('debugger').view.ready();
            return detail.selectProcess(call.processId);
          }
          if (button.dataset.action === 'methods') {
            world.send('system-browser', 'open');
            return development.execute({ op: 'browse', action: 'reveal', className: instance.wrapper.klass.name });
          }
          if (button.dataset.action === 'save') return run({ op: 'objects.save', target: instance.reference });
          if (button.dataset.action === 'export') {
            const source = runtime.sourceOf(instance);
            const url = URL.createObjectURL(new Blob([JSON.stringify(source, null, 2) + '\n'], { type: 'application/json' }));
            const link = element('a'); link.href = url; link.download = `${source.manifest.name}.smallslop.json`;
            link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
            return;
          }
          const source = await request({ op: 'modules.source', version: instance.module.version });
          return development.inspect(world.host.value(source));
        }).catch(report);
      });
      refreshList();
      return { refresh: refreshList, state: () => ({ instances: runtime.instances.size }) };
    } });

  return { identity: runtime.identity, runtime, client, run, request, execute, panes,
    connect: () => request({ op: 'runtimes.register', identity: runtime.identity }),
    command({ identity, request }) {
      if (['namespace', 'runtime', 'incarnation'].some(key => identity[key] !== runtime.identity[key])) throw new Error('Component command targets another page incarnation.');
      return execute(request);
    },
  };
}
