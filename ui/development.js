import { Inspectors } from '../src/index.js';
import { BrowserService, installSystemBrowser } from './system-browser.js';
import { InspectorService } from './object-inspector.js';
import { systemBrowserView } from './system-browser-view.js';
import { objectInspectorView } from './object-inspector-view.js';
import { debuggerView } from './debugger-view.js';
import { element } from './pane-view.js';

const browserActions = { category: 'selectCategory:', class: 'selectClass:', side: 'selectSide:', protocol: 'selectProtocol:',
  method: 'selectMethod:', source: 'editSource:', methodProtocol: 'editProtocol:', new: 'newMethod', accept: 'accept',
  revert: 'revert', breakpoint: 'toggleBreakpoint', find: 'find:', clearResults: 'clearResults', reveal: 'browseClass:method:' };

export function createWorkspaceDevelopment(workspace, { server } = {}) {
  const { world, report } = workspace;
  const inspectors = new Inspectors(world.host, world.debugger);
  const tools = new Set();
  let refreshing = false;
  const refresh = () => {
    if (refreshing) return;
    refreshing = true;
    try { for (const id of tools) {
      const pane = world.panes.get(id);
      if (!pane) tools.delete(id);
      else if (pane.object.slots.visible) pane.view.refresh();
    } }
    finally { refreshing = false; }
  };
  const adapter = { runtime: world.runtime, host: world.host, inspector: world.debugger, inspectors, touch: refresh, server,
    dispatch: request => request.op === 'methods' ? world.debugger.methods({}).filter(method => method.format === 'source') : execute(request) };
  installSystemBrowser(adapter, world.klass, { retainOnClose: true });
  const perform = action => Promise.resolve().then(action).then(refresh).catch(report);
  const options = { world: adapter, element, perform, command: request => execute(request) };

  const browserPane = workspace.add({ id: 'system-browser', title: 'System Browser', className: 'SystemBrowser',
    description: 'Browse classes, edit methods, and set breakpoints.', bounds: { x: 180, y: 70, width: 950, height: 640 },
    create(body, { on, pane }) {
      const detail = systemBrowserView(pane, body, on, options);
      detail.render();
      return { ...detail, state: () => pane.browser.state() };
    } });
  browserPane.browser = new BrowserService(adapter, browserPane, { category: 'Workspace', className: 'Pane' });
  tools.add(browserPane.id);
  workspace.add({ id: 'debugger', title: 'Debugger', description: 'Inspect processes, step, retry, and evaluate debugger commands.',
    bounds: { x: 250, y: 100, width: 750, height: 650 },
    create: (body, { on, pane }) => debuggerView(pane, body, on, options) });
  tools.add('debugger');

  function openInspection(snapshot, association, { runtime = 'page', server } = {}) {
    const id = `inspector-${crypto.randomUUID()}`;
    const inspection = new InspectorService(server ? { ...adapter, server } : adapter, runtime, snapshot);
    const pane = workspace.add({ id, title: `Inspector: ${snapshot.className}`, association,
      owner: runtime === 'page' ? inspectors.get(snapshot.id).object : null, description: 'Fields, messages, and expression results for this object.',
      bounds: { x: 260, y: 100, width: 660, height: 580 },
      create(body, { on, pane }) {
        const detail = objectInspectorView(pane, body, on, options);
        detail.render();
        return { ...detail, state: () => inspection.state(), dispose() { detail.dispose(); return inspection.close(); } };
      } });
    pane.inspection = inspection;
    tools.add(id);
    world.send(id, 'open');
    return { id, object: snapshot.subject };
  }

  function execute(request) {
    if (request.op === 'browse') {
      if (request.action === 'state') return browserPane.browser.state();
      const selector = browserActions[request.action];
      if (!selector) throw new Error(`Unknown browser action: ${request.action}.`);
      const args = request.action === 'reveal' ? [request.className, request.selector ?? null] : selector.endsWith(':') ? [request.value] : [];
      world.send(browserPane.id, selector, args);
      refresh();
      return browserPane.browser.state();
    }
    if (request.op === 'objectInspector') {
      const pane = world.require(request.id);
      const service = pane.inspection;
      if (!service) throw new Error(`${request.id} is not an object inspector.`);
      if (['openSelected', 'openResult', 'openClass'].includes(request.action)) {
        const snapshot = service.request({ action: request.action });
        const open = value => openInspection(value, pane.association, { runtime: service.runtime, server: service.world.server });
        return snapshot?.then ? snapshot.then(open) : open(snapshot);
      }
      if (request.action === 'browse') {
        world.send('system-browser', 'browseClass:method:', [service.state().className, null]);
        world.send('system-browser', 'open');
        refresh();
        return { id: 'system-browser' };
      }
      if (request.action === 'debugger') {
        const state = service.state();
        const process = state.command?.status === 'paused' ? state.command : state.process;
        if (!process) throw new Error('Evaluate an expression first.');
        const retained = service.request({ action: 'retain', processId: process.id });
        const open = () => {
        const id = `debugger-${crypto.randomUUID()}`;
        const inspection = new InspectorService(service.world, service.runtime, state, process.id);
        const debuggerPane = workspace.add({ id, title: 'Expression debugger', association: pane.association,
          description: 'Debug the retained inspector evaluation.', bounds: { x: 320, y: 90, width: 720, height: 650 },
          create(body, { on, pane }) {
            const detail = debuggerView(pane, body, on, { ...options, world: service.world });
            return { ...detail, dispose() { return inspection.close(); } };
          } });
        debuggerPane.inspection = inspection;
        tools.add(id);
        world.send(id, 'open');
        return { id };
        };
        return retained?.then ? retained.then(open) : open();
      }
      if (request.action === 'debug') return service.request({ action: 'debug', request: request.request });
      const result = service.command(request.action, request.value);
      refresh();
      return result;
    }
    return workspace.dispatch(request);
  }

  function serverDisconnected() {
    for (const pane of world.panes.values()) if (pane.inspection?.runtime === 'server') pane.inspection.disconnected = true;
    refresh();
  }

  return { execute, refresh, serverDisconnected, inspect: (value, association) => openInspection(inspectors.open(value).state(), association),
    remoteInspector: (snapshot, server) => openInspection(snapshot, null, { runtime: 'server', server }) };
}
