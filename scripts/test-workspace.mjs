import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpConnection } from './cdp-connection.mjs';
import { createSmallslopServer } from '../server/server.mjs';
import { smallslopTools } from '../server/agent.mjs';
import { options } from '../examples/workspace.mjs';

const directory = await mkdtemp(join(tmpdir(), 'smallslop-workspace-test-'));
const calls = [];
let app;
let browser;
let cdp;
let browserError = '';
let hold = null;

async function testAgent({ page, server, onEvent }) {
  const tools = smallslopTools({ page, server });
  const call = async (name, args) => {
    const result = await tools.find(tool => tool.name === name).execute('test-call', args, new AbortController().signal);
    calls.push({ name, args });
    return JSON.parse(result.content[0].text);
  };
  return {
    model: 'test/fixture',
    async prompt(message, context) {
      const state = await call('smallslop_state', {});
      assert.ok(state.commands.some(command => command.op === 'browse'));
      assert.equal(context.focused, state.focused);
      if (message === 'system-browser') {
        await call('smallslop_command', { command: '{"op":"open","id":"system-browser"}' });
        const browsed = await call('smallslop_command', { command: '{"op":"browse","action":"reveal","className":"Pane","selector":"open"}' });
        assert.equal(browsed.selector, 'open');
      } else if (message === 'database') {
        const created = await call('smallslop_server', { command: '{"op":"execute","sql":"CREATE TABLE notes(text TEXT)"}' });
        assert.equal(created.process.status, 'completed');
        const inserted = await call('smallslop_server', { command: JSON.stringify({ op: 'execute', sql: 'INSERT INTO notes VALUES (?) RETURNING text', parameters: ['first'] }) });
        const rows = await call('smallslop_server', { command: JSON.stringify({ op: 'next', id: inserted.result.id, count: 10 }) });
        assert.deepEqual(rows.value, [['first']]);
        await call('smallslop_server', { command: JSON.stringify({ op: 'close', id: inserted.result.id }) });
        await call('smallslop_command', { command: '{"op":"inspect","runtime":"server"}' });
      } else if (message === 'hold') {
        hold = Promise.withResolvers();
        await hold.promise;
        return;
      }
      onEvent({ role: 'assistant', text: `Finished ${message}.` });
    },
    async interrupt() { hold?.resolve(); },
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
  app = createSmallslopServer({ ...options, createAgent: testAgent });
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
  assert.equal(await evaluate(sessionId, `smallslop.command({op: 'browse', action: 'state'}).className`), 'Pane');
  assert.ok(await evaluate(sessionId, `[...document.querySelectorAll('.agent-message.assistant')].some(node => node.textContent.includes('Finished system-browser.'))`));

  await prompt(sessionId, 'database');
  await until(sessionId, `${idle} && [...smallslop.workspace.world.panes.values()].some(pane => pane.object.slots.title === 'Inspector: Database')`);
  await evaluate(sessionId, `smallslop.command({op: 'open', id: 'debugger'}) && null`);
  assert.deepEqual(await evaluate(sessionId, `[...smallslop.workspace.world.panes.get('debugger').view.body.querySelector('select').options].map(option => option.value)`), ['Page', 'Server']);
  await evaluate(sessionId, `(() => {
    const realm = smallslop.workspace.world.panes.get('debugger').view.body.querySelector('select');
    realm.value = 'Server';
    realm.dispatchEvent(new Event('change'));
  })()`);
  await until(sessionId, `[...smallslop.workspace.world.panes.get('debugger').view.body.querySelectorAll('option')].some(option => option.textContent === 'Database execute:parameters:')`);

  await prompt(sessionId, 'hold');
  await until(sessionId, `document.querySelector('#connection-status').textContent === 'Agent: Running'`);
  await evaluate(sessionId, `[...smallslop.workspace.world.panes.get('agent').view.body.querySelectorAll('button')].find(button => button.textContent === 'Stop').click()`);
  await until(sessionId, `document.querySelector('#connection-status').textContent === 'Agent: Interrupted'`);

  await evaluate(sessionId, `[...smallslop.workspace.world.panes.get('agent').view.body.querySelectorAll('button')].find(button => button.textContent === 'Reset').click()`);
  await until(sessionId, `${idle} && document.querySelectorAll('.agent-message').length === 0`);
  assert.deepEqual(await evaluate(sessionId, `smallslop.workspace.state().activity`), []);
  assert.ok(calls.some(call => call.name === 'smallslop_server'));
  console.log('Chromium passed the workspace agent, page command, server database, interrupt, and reset tests.');
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
