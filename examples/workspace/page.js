import { createWorkspace } from '../../ui/workspace.js';
import { createWorkspaceDevelopment } from '../../ui/development.js';
import { element } from '../../ui/pane-view.js';
import { AgentConnection } from '../../ui/agent-connection.js';

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
];

const views = new Set();
let session = { status: 'Connecting', model: '', messages: [] };
let development;

const connection = new AgentConnection({ command, session: receive, error: error => {
  workspace.report(error);
  if (!connection.connected) receive({ ...session, status: 'Disconnected' });
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
  return development.execute(request);
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
        messages.replaceChildren(...session.messages.map(entry => {
          const node = element('article', undefined, `agent-message ${entry.role}`);
          node.append(element('span', entry.role, 'role'));
          if (['tool', 'result'].includes(entry.role)) {
            const details = element('details');
            details.append(element('summary', entry.text.split(/[ :]/, 1)[0]), element('pre', entry.text));
            node.append(details);
          } else node.append(element('p', entry.text));
          return node;
        }));
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
globalThis.smallslop = { workspace, development, connection, command };
connection.connect();
