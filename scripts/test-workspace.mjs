import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpConnection } from '../server/debug-connection.mjs';
import { createSmallslopServer } from '../server/server.mjs';
import { smallslopTools } from '../server/agent.mjs';
import { options } from '../examples/workspace.mjs';

const directory = await mkdtemp(join(tmpdir(), 'smallslop-workspace-test-'));
const calls = [];
let app;
let browser;
let cdp;
let browserError = '';

async function testAgent({ page, server, onEvent }) {
  const tools = smallslopTools({ page, server });
  let stopped = null;
  const call = async (name, args) => {
    onEvent({ role: 'tool', text: `${name} ${JSON.stringify(args)}` });
    const result = await tools.find(tool => tool.name === name).execute('test-call', args, new AbortController().signal);
    calls.push({ name, args });
    onEvent({ role: 'result', text: `${name}: ${result.content[0].text.slice(0, 200)}` });
    return JSON.parse(result.content[0].text);
  };
  return {
    model: 'test/fixture',
    async prompt(message, context) {
      stopped = Promise.withResolvers();
      const state = await call('smallslop_state', {});
      assert.ok(state.commands.some(command => command.op === 'browse'));
      assert.equal(context.focused, state.focused);
      if (message === 'system-browser') {
        await call('smallslop_command', { command: '{"op":"open","id":"system-browser"}' });
        const browsed = await call('smallslop_command', { command: '{"op":"browse","action":"reveal","className":"Inspector","selector":"select:"}' });
        assert.equal(browsed.className, 'Inspector');
        assert.equal(browsed.selector, 'select:');
      } else if (message === 'database') {
        const created = await call('smallslop_server', { command: '{"op":"execute","sql":"CREATE TABLE notes(text TEXT)"}' });
        assert.equal(created.process.status, 'completed');
        const inserted = await call('smallslop_server', { command: JSON.stringify({ op: 'execute', sql: 'INSERT INTO notes VALUES (?) RETURNING text', parameters: ['first'] }) });
        const rows = await call('smallslop_server', { command: JSON.stringify({ op: 'next', id: inserted.result.id, count: 10 }) });
        assert.deepEqual(rows.value, [['first']]);
        await call('smallslop_server', { command: JSON.stringify({ op: 'close', id: inserted.result.id }) });
        await call('smallslop_command', { command: '{"op":"inspect","runtime":"server"}' });
      } else if (message === 'components') {
        const instances = await call('smallslop_command', { command: JSON.stringify({ op: 'components', request: { op: 'objects.list', runtime: 'page' } }) });
        assert.ok(instances.some(instance => instance.className === 'DiskPane' && instance.status === 'ready'));
      } else if (message === 'hold') {
        await stopped.promise;
        return;
      }
      onEvent({ role: 'assistant', text: `Finished ${message}.` });
    },
    async interrupt() { stopped?.resolve(); },
    dispose() {},
  };
}

function status(path, headers = {}) {
  return new Promise((resolve, reject) => {
    httpRequest(`http://127.0.0.1:${app.server.address().port}${path}`, { headers }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject).end();
  });
}

async function evaluate(sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function until(sessionId, expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(sessionId, expression);
    if (value) return value;
    await delay(25);
  }
  const detail = await evaluate(sessionId, `({status: document.querySelector('#connection-status').textContent, activity: smallslop.workspace.state().activity})`);
  throw new Error(`Timed out: ${expression}\n${JSON.stringify(detail)}`);
}

async function prompt(sessionId, text) {
  await evaluate(sessionId, `(() => {
    const body = smallslop.workspace.world.panes.get('agent').view.body;
    body.querySelector('textarea').value = ${JSON.stringify(text)};
    body.querySelector('button[type=submit]').click();
  })()`);
}

const idle = `document.querySelector('#connection-status').textContent === 'Agent: Ready'`;

try {
  app = createSmallslopServer({ ...options, createAgent: testAgent, components: { directory: join(directory, 'components'), namespace: 'test' } });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => { app.server.off('error', reject); resolve(); });
  });
  const url = `http://127.0.0.1:${app.server.address().port}/`;
  assert.equal(await status('/', { Host: 'foreign.invalid' }), 403);
  assert.equal(await status('/'), 302);
  assert.equal(await status('/src/runtime.js'), 200);
  assert.equal(await status('/server/world.mjs'), 404);
  assert.equal(await status('/src/%2e%2e/server/world.mjs'), 404);
  assert.equal(await status('/package.json'), 404);
  assert.equal(await status('/examples/workspace.mjs'), 404);

  browser = spawn(process.env.CHROMIUM ?? 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { browserError += chunk; });
  let port;
  const deadline = Date.now() + 15000;
  while (!port && Date.now() < deadline) {
    try { port = (await readFile(join(directory, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
  }
  if (!port) throw new Error(`Chromium did not start: ${browserError}`);
  const endpoint = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = new CdpConnection(endpoint.webSocketDebuggerUrl);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await until(sessionId, `globalThis.smallslop && ${idle}`);

  await prompt(sessionId, 'system-browser');
  await until(sessionId, `${idle} && smallslop.workspace.world.panes.get('system-browser').object.slots.visible`);
  assert.equal(await evaluate(sessionId, `smallslop.command({op: 'browse', action: 'state'}).className`), 'Inspector');
  assert.equal(await evaluate(sessionId, `smallslop.command({op: 'browse', action: 'side', value: 'class'}).owner`), 'Inspector class');
  assert.equal(await evaluate(sessionId, `smallslop.command({op: 'browse', action: 'side', value: 'instance'}).owner`), 'Inspector');
  assert.ok(await evaluate(sessionId, `[...document.querySelectorAll('.agent-message.assistant')].some(node => node.textContent.includes('Finished system-browser.'))`));

  const firstDetails = `smallslop.workspace.world.panes.get('agent').view.body.querySelector('details')`;
  await evaluate(sessionId, `${firstDetails}.open = true`);
  await prompt(sessionId, 'database');
  await until(sessionId, `${idle} && [...smallslop.workspace.world.panes.values()].some(pane => pane.object.slots.title === 'Inspector: Database')`);
  assert.equal(await evaluate(sessionId, `${firstDetails}.open`), true);
  await evaluate(sessionId, `smallslop.command({op: 'open', id: 'debugger'}) && null`);
  assert.deepEqual(await evaluate(sessionId, `[...smallslop.workspace.world.panes.get('debugger').view.body.querySelector('select').options].map(option => option.value)`), ['Page', 'Server']);
  await evaluate(sessionId, `(() => {
    const realm = smallslop.workspace.world.panes.get('debugger').view.body.querySelector('select');
    realm.value = 'Server';
    realm.dispatchEvent(new Event('change'));
  })()`);
  await until(sessionId, `[...smallslop.workspace.world.panes.get('debugger').view.body.querySelectorAll('option')].some(option => option.textContent === 'Database execute:parameters:')`);

  await until(sessionId, `smallslop.components?.identity.namespace === 'test'`);
  await evaluate(sessionId, `document.querySelector('#disk-example').click()`);
  await until(sessionId, `[...smallslop.workspace.world.panes.values()].some(pane => pane.object.slots.title === 'Disk usage' && pane.object.slots.visible)`);
  await evaluate(sessionId, `[...smallslop.workspace.world.panes.values()].find(pane => pane.object.slots.title === 'Disk usage').view.body.querySelector('button').click()`);
  const usage = await until(sessionId, `(() => {
    const text = [...smallslop.workspace.world.panes.values()].find(pane => pane.object.slots.title === 'Disk usage').view.body.querySelector('pre').textContent;
    return text.includes('Used bytes') && text;
  })()`);
  assert.match(usage, /^\/\nUsed bytes: \d+\nFree bytes: \d+/);
  await evaluate(sessionId, `smallslop.command({op: 'open', id: 'components'}) && null`);
  await evaluate(sessionId, `smallslop.workspace.world.panes.get('components').view.body.querySelector('[data-action="inspect"]').focus()`);
  await evaluate(sessionId, `[...smallslop.workspace.world.panes.values()].find(pane => pane.object.slots.title === 'Disk usage').view.body.querySelector('button').click()`);
  await until(sessionId, `smallslop.components.runtime.calls.size === 0`);
  assert.equal(await evaluate(sessionId, `document.activeElement.dataset.action === 'inspect' && smallslop.workspace.world.panes.get('components').view.body.contains(document.activeElement)`), true);
  const mount = await evaluate(sessionId, `(async () => {
    const { run, identity } = smallslop.components;
    const module = await run({ op: 'modules.install', manifest: { name: 'broken-pane', target: 'browser', interface: { className: 'BrokenPane' } },
      files: { 'index.mjs': 'export function create() { return { mount() { throw new Error("Mount failed."); } }; }' } });
    const broken = await run({ op: 'objects.create', runtime: identity.runtime, version: module.version, configuration: { kind: 'record', value: {} } });
    try { await run({ op: 'panes.open', target: broken.reference }); } catch (error) {
      return { error: error.message, panes: [...smallslop.workspace.world.panes.keys()].filter(id => id.startsWith('component-')).length };
    }
  })()`);
  assert.deepEqual(mount, { error: 'Mount failed.', panes: 1 });
  await prompt(sessionId, 'components');
  await until(sessionId, `${idle} && [...document.querySelectorAll('.agent-message.assistant')].some(node => node.textContent.includes('Finished components.'))`);

  const paneTitled = title => `[...smallslop.workspace.world.panes.values()].find(pane => pane.object.slots.title === '${title}')`;
  const diskText = `${paneTitled('Disk usage')}.view.body.querySelector('pre').textContent`;
  const before = await evaluate(sessionId, diskText);
  await evaluate(sessionId, `smallslop.connection.socket.close()`);
  await until(sessionId, `document.querySelector('#connection-status').textContent === 'Agent: Disconnected'`);
  await until(sessionId, `${paneTitled('Inspector: Database')}.view.body.textContent.includes('Server disconnected')`);
  await evaluate(sessionId, `[...smallslop.workspace.world.panes.get('agent').view.body.querySelectorAll('button')].find(button => button.textContent === 'Reconnect').click()`);
  await until(sessionId, idle);
  await evaluate(sessionId, `document.querySelector('#disk-example').click()`);
  await until(sessionId, `[...smallslop.workspace.world.panes.values()].filter(pane => pane.object.slots.title === 'Disk usage').length === 1 && ${paneTitled('Disk usage')}.object.slots.visible`);
  await evaluate(sessionId, `${paneTitled('Disk usage')}.view.body.querySelector('button').click()`);
  await until(sessionId, `${diskText} !== ${JSON.stringify(before)}`);
  assert.equal(await evaluate(sessionId, `smallslop.components.runtime.calls.size`), 0);
  await prompt(sessionId, 'components');
  await until(sessionId, `${idle} && [...document.querySelectorAll('.agent-message.assistant')].some(node => node.textContent.includes('Finished components.'))`);

  await prompt(sessionId, 'hold');
  await until(sessionId, `document.querySelector('#connection-status').textContent === 'Agent: Running'`);
  await evaluate(sessionId, `[...smallslop.workspace.world.panes.get('agent').view.body.querySelectorAll('button')].find(button => button.textContent === 'Stop').click()`);
  await until(sessionId, `document.querySelector('#connection-status').textContent === 'Agent: Interrupted'`);

  await evaluate(sessionId, `[...smallslop.workspace.world.panes.get('agent').view.body.querySelectorAll('button')].find(button => button.textContent === 'Reset').click()`);
  await until(sessionId, `${idle} && document.querySelectorAll('.agent-message').length === 0`);
  assert.deepEqual(await evaluate(sessionId, `smallslop.workspace.state().activity.map(entry => entry.message).sort()`),
    ['Mount failed.', 'The session connection closed. Reconnect to start a new session.']);
  await evaluate(sessionId, `smallslop.command({op: 'move', id: 'system-browser', x: 300, y: 50}) && null`);
  await delay(300);
  await cdp.send('Page.reload', {}, sessionId);
  await until(sessionId, `globalThis.smallslop && ${idle}`);
  assert.equal(await evaluate(sessionId, `smallslop.workspace.world.panes.get('system-browser').object.slots.x`), 300);
  assert.ok(calls.some(call => call.name === 'smallslop_server'));
  console.log('Chromium passed the workspace agent, page command, server database, component, reconnect, interrupt, reset, and arrangement tests.');
} finally {
  const exit = browser?.exitCode === null ? new Promise(resolve => browser.once('exit', resolve)) : Promise.resolve();
  if (cdp) { await cdp.send('Browser.close'); await cdp.close(); }
  if (browser) {
    if (!cdp) browser.kill('SIGTERM');
    await exit;
  }
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}
