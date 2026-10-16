import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createSmallslopServer } from '../server/server.mjs';
import { createPiAgent, smallslopTools } from '../server/agent.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const options = { root, directories: ['src', 'ui', 'components', 'examples/workspace', 'examples/components'], index: '/examples/workspace/index.html' };

export const instructions = `You operate a live Smallslop workspace page through its objects and debugger.
Read smallslop_state at the start and after changing the page. The user sees each change and can keep using the page during your turn.
The page contains movable, resizable panes, including this agent, the System Browser, the Debugger, object inspectors, Panes, and Activity. Use the commands listed in the page state.
The server runtime holds a SQLite database. For database requests, call smallslop_server schema first. SQL accepts reads, writes, and schema changes, one statement per execution, with bound parameters. Parameters accept JSON strings, numbers, and null, or Smallslop encodings. Integer and byte values use {kind:"integer",value:"123"} and {kind:"bytes",value:[0,255]}. Result columns accompany row arrays. Close results after inspecting them.
The request includes a captured context. Resolve "this pane" from that context even if the user changes focus during your turn. Ask if the context is ambiguous.
Pane coordinates are pixels relative to the workspace. Keep the agent pane and title bars accessible.
Check returned process status: a paused error, warning, or breakpoint needs inspection and repair before you claim completion. An unhandled Error pauses at its failed instruction, and retry runs that instruction again.
The debug command exposes the Smallslop debugger. It supports inspect, object, method, evaluate, install, breakpoint, clearBreakpoint, pause, run, resume, step, stepOver, stepOut, setVariable, setSendOperand, retry, cancel, dispose, release, retainMethod, releaseMethods, releaseAll, and stopOnSignal. Values encode as {kind:"string",value:"text"}, {kind:"symbol",value:"name"}, {kind:"character",value:97}, {kind:"float",value:1}, {kind:"integer",value:"1"}, {kind:"boolean",value:true}, {kind:"nil"}, or an object handle from state. Evaluate creates a paused process. Run or step it, then dispose it when finished. Release inspection handles when finished.
Process IDs and object handles belong to their runtime. A page process uses smallslop_command debug. A server process uses smallslop_server debug.
The components command sends a request to the component service and waits for its result. Install a module with {op:"modules.install",manifest,files}, create an instance with {op:"objects.create",runtime:"server" or "page",version,configuration,bindings}, call it with {op:"objects.send",target,selector,args}, and show a browser instance with {op:"panes.open",target,title}. Configuration, arguments, and results use tagged values such as {kind:"record",value:{path:{kind:"string",value:"/tmp"}}} and {kind:"array",value:[]}. The diskExample command installs and opens the disk-usage example.
Change methods or debugger state when the user asks for programming or repair. The page and server runtimes save each class change to the class's source file.
Give a concise final answer stating the completed changes and any failures. A capability question asks for an answer, rather than execution.`;

if (import.meta.main) {
  let host = '127.0.0.1';
  let port = 0;
  let databasePath = ':memory:';
  let componentDirectory = resolve(root, '.local/components');
  let sourceRoot = resolve(root, 'smalltalk');
  const args = process.argv.slice(2);
  while (args.length) {
    const arg = args.shift();
    if (arg === '--host' && args.length) host = args.shift();
    else if (arg === '--port' && args.length) port = Number(args.shift());
    else if (arg === '--database' && args.length) databasePath = resolve(args.shift());
    else if (arg === '--components' && args.length) componentDirectory = resolve(args.shift());
    else if (arg === '--sources' && args.length) sourceRoot = resolve(args.shift());
    else throw new Error(`Unknown or incomplete option: ${arg}. Use --host ADDRESS, --port PORT, --database FILE, --components DIRECTORY, or --sources DIRECTORY.`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 through 65535.');
  const app = createSmallslopServer({ ...options, databasePath, sourceRoot, components: { directory: componentDirectory, namespace: 'workspace' },
    createAgent: ({ page, server, onEvent }) => createPiAgent({ cwd: root, instructions, tools: smallslopTools({ page, server }), onEvent }) });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, () => { app.server.off('error', reject); resolve(); });
  });
  const shown = ['::', '0.0.0.0'].includes(host) ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  console.log(`Smallslop workspace: http://${shown}:${app.server.address().port}/`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close());
}
