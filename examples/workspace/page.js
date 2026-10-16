import { createWorkspace } from '../../ui/workspace.js';
import { createWorkspaceDevelopment } from '../../ui/development.js';
import { element } from '../../ui/pane-view.js';
import { createWorkspaceComponents } from '../../ui/components.js';
import { SessionConnection } from '../../ui/session-connection.js';
import { encode } from '../../components/values.js';

const commands = [
  { op: 'state', description: 'Read the panes, their contents, and these commands.' },
  { op: 'open | close | focus | enlarge', id: 'Pane ID', description: 'Show, hide, focus, or enlarge a pane.' },
  { op: 'move', id: 'Pane ID', x: 'Pixels', y: 'Pixels' },
  { op: 'resize', id: 'Pane ID', width: 'Pixels', height: 'Pixels' },
  { op: 'send', id: 'Pane ID', selector: 'Message selector', args: 'Debugger-encoded values', description: 'Send a message to a pane object.' },
  { op: 'browse', action: 'state | category | class | side | protocol | method | source | methodProtocol | new | accept | revert | breakpoint | find | clearResults | reveal',
    value: 'Selection, source, or search text', className: 'For reveal', selector: 'For reveal', description: 'Operate the System Browser.' },
  { op: 'inspect', id: 'Optional pane ID', value: 'Optional debugger-encoded value', runtime: 'page | server',
    description: 'Open an object inspector. The page default is the named or focused pane. The server default is its Database.' },
  { op: 'objectInspector', id: 'Inspector pane ID', action: 'state | select | page | expression | evaluate | run | resume | pause | step | stepOver | stepOut | retry | cancel | openSelected | openResult | openClass | browse | debugger | debug',
    value: 'Field key, collection offset, expression text, or run/debug evaluation mode', description: 'Operate an object inspector. debug takes a debugger request.' },
  { op: 'debug', request: 'Debugger request', description: 'Use the page debugger.' },
  { op: 'components', request: 'Component request', description: 'Send a request to the component service and wait for its result.' },
  { op: 'diskExample', description: 'Install the disk-usage example components and open their pane.' },
];

const diskManifests = {
  reader: { name: 'disk-reader', target: 'server',
    interface: { className: 'DiskReader', messages: { usage: { method: 'usage', arity: 0 } } } },
  pane: { name: 'disk-pane', target: 'browser', bindings: { disk: ['usage'] },
    interface: { className: 'DiskPane', messages: { refresh: { method: 'refresh', arity: 0 }, state: { method: 'state', arity: 0 } } } },
};

const views = new Set();
let session = { status: 'Connecting', model: '', messages: [] };
let development;
let components;
let diskPane = null;

const connection = new SessionConnection({ command, session: receive, open: () => connectComponents().catch(report), error: error => {
  workspace.report(error);
  if (!connection.connected) {
    development.serverDisconnected();
    receive({ ...session, status: 'Disconnected' });
  }
} });
const workspace = createWorkspace({
  container: document.querySelector('#workspace'),
  toolbar: document.querySelector('#toolbar'),
  definitions: [agentPane()],
  storage: localStorage,
  storageKey: 'smallslop-workspace',
  onChange: () => development?.refresh(),
});
development = createWorkspaceDevelopment(workspace, { server: request => connection.server(request) });
const { world, report } = workspace;

function context() { return { focused: world.focused }; }

function command(request) {
  if (request.op === 'state') return { ...workspace.state(), commands };
  if (request.op === 'inspect') return inspect(request);
  if (request.op === 'components') return requireComponents().run(request.request);
  if (request.op === 'componentRuntime') return requireComponents().command(request);
  if (request.op === 'diskExample') return openDiskExample();
  return development.execute(request);
}

function requireComponents() {
  if (!components) throw new Error('The component service is not connected.');
  return components;
}

async function connectComponents() {
  if (!components) {
    const { namespace } = await connection.components({ op: 'runtimes.describe' });
    components ??= createWorkspaceComponents({ workspace, development, namespace, request: value => connection.components(value) });
    globalThis.smallslop.components = components;
  }
  await components.connect();
}

async function openDiskExample() {
  const { run, identity, runtime } = requireComponents();
  if (diskPane && runtime.instances.get(diskPane.id)?.status === 'ready') return run({ op: 'panes.open', target: diskPane });
  const source = async name => {
    const response = await fetch(new URL(`../components/${name}.mjs`, import.meta.url));
    if (!response.ok) throw new Error(`Cannot read the ${name} example: HTTP ${response.status}.`);
    return response.text();
  };
  const reader = await run({ op: 'modules.install', manifest: diskManifests.reader, files: { 'index.mjs': await source('disk-reader') } });
  const disk = await run({ op: 'objects.create', runtime: 'server', version: reader.version, configuration: encode({ path: '/' }) });
  const view = await run({ op: 'modules.install', manifest: diskManifests.pane, files: { 'index.mjs': await source('disk-pane') } });
  const display = await run({ op: 'objects.create', runtime: identity.runtime, version: view.version,
    configuration: encode({}), bindings: { disk: disk.reference } });
  diskPane = display.reference;
  return run({ op: 'panes.open', target: display.reference, title: 'Disk usage' });
}

function inspect({ id, value, runtime = 'page' }) {
  if (runtime === 'server') {
    const server = request => connection.server(request);
    const open = value => server({ op: 'inspector', action: 'open', value }).then(snapshot => development.remoteInspector(snapshot, server));
    return value ? open(value) : server({ op: 'state' }).then(state => open(state.database));
  }
  if (runtime !== 'page') throw new Error('Choose the page or server runtime.');
  if (value) return development.inspect(world.debugger.decode(value));
  if (!id && !world.focused) throw new Error('Name a pane or value to inspect.');
  return development.inspect(world.require(id ?? world.focused).object);
}

function receive(state) {
  session = state;
  document.querySelector('#connection-status').textContent = `Agent: ${state.status}`;
  for (const render of views) render();
}

function agentPane() {
  return { id: 'agent', title: 'Agent', open: true,
    description: 'A conversation with the agent, which operates this page through its commands.',
    bounds: { x: 16, y: 16, width: 380, height: 620 },
    create(body, { on, report }) {
      body.classList.add('pane-content', 'agent');
      const actions = element('div', undefined, 'pane-actions');
      const status = element('span', '', 'pane-status');
      status.setAttribute('role', 'status');
      const model = element('span', '', 'pane-status');
      const stop = element('button', 'Stop');
      const reset = element('button', 'Reset');
      const reconnect = element('button', 'Reconnect');
      actions.append(status, model, stop, reset, reconnect);
      const messages = element('div', undefined, 'agent-messages');
      messages.setAttribute('role', 'log');
      messages.setAttribute('aria-label', 'Agent conversation');
      const form = element('form', undefined, 'agent-form');
      const prompt = element('textarea');
      prompt.setAttribute('aria-label', 'Message to the agent');
      const send = element('button', 'Send');
      send.type = 'submit';
      form.append(prompt, send);
      body.append(actions, messages, form);
      const displayed = [];
      const submit = () => {
        const text = prompt.value.trim();
        if (!text || send.disabled) return;
        prompt.value = '';
        connection.ask(text, context()).catch(report);
      };
      on(form, 'submit', event => { event.preventDefault(); submit(); });
      on(prompt, 'keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
      });
      on(stop, 'click', () => { try { connection.interrupt(); } catch (error) { report(error); } });
      on(reset, 'click', () => connection.reset().catch(report));
      on(reconnect, 'click', () => connection.connect());
      const render = () => {
        const busy = ['Running', 'Interrupting'].includes(session.status);
        status.textContent = session.status;
        model.textContent = session.model;
        send.disabled = busy || !connection.connected;
        stop.disabled = !busy;
        reset.disabled = busy || !connection.connected;
        reconnect.hidden = connection.connected;
        const bottom = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 30;
        const entries = session.messages;
        while (messages.children.length > entries.length) messages.lastElementChild.remove();
        displayed.length = Math.min(displayed.length, entries.length);
        for (const [index, entry] of entries.entries()) {
          if (displayed[index]?.id === entry.id && displayed[index]?.text === entry.text) continue;
          const node = element('article', undefined, `agent-message ${entry.role}`);
          node.append(element('span', entry.role, 'role'));
          if (['tool', 'result'].includes(entry.role)) {
            const details = element('details');
            details.append(element('summary', entry.text.split(/[ :]/, 1)[0]), element('pre', entry.text));
            node.append(details);
          } else node.append(element('p', entry.text));
          const previous = messages.children[index];
          if (previous) previous.replaceWith(node); else messages.append(node);
          displayed[index] = { id: entry.id, text: entry.text };
        }
        if (bottom) messages.scrollTop = messages.scrollHeight;
      };
      views.add(render);
      render();
      return { refresh: render, state: () => ({ status: session.status, model: session.model, messages: session.messages.length }),
        dispose() { views.delete(render); } };
    } };
}

document.querySelector('#inspect-database').addEventListener('click', () => {
  Promise.resolve().then(() => inspect({ runtime: 'server' })).catch(report);
});
document.querySelector('#disk-example').addEventListener('click', () => openDiskExample().catch(report));
globalThis.smallslop = { workspace, development, connection, command, components };
connection.connect();
