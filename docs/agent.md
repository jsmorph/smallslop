# Agent and Web Server

The Web server in [`server/server.mjs`](../server/server.mjs) serves a page
and gives each connected page a session over one WebSocket.  A session owns a
server Smallslop runtime with a SQLite database, a Pi agent, and access to
the component service.  The agent works through three tools: one reads the
page state, one runs page commands, and one runs server runtime commands.
The page carries out page commands with the same objects and debugger that
its controls use, so the user sees each change as the agent makes it.

## Running the workspace

`npm run workspace` runs [`examples/workspace.mjs`](../examples/workspace.mjs),
which starts the server and prints the page URL.  The page is
[`examples/workspace/page.js`](../examples/workspace/page.js).  It opens with
an agent pane, and its Panes button lists the System Browser, the Debugger,
the Components pane, and the activity log.  Inspect database opens an
inspector on the server's `Database` object, and Disk example installs and
opens the [disk-usage components](components.md#the-disk-example).

| Option | Default | Effect |
| --- | --- | --- |
| `--host ADDRESS` | `127.0.0.1` | Listening address.  `::` listens on all interfaces. |
| `--port PORT` | `0`, which selects a free port | Listening port |
| `--database FILE` | `:memory:` | SQLite database.  With the default, each page connection has its own empty database. |
| `--components DIRECTORY` | `.local/components` in the repository | Component store |

The agent requires a Pi model credential: a login stored in Pi's
`auth.json`, or a provider key in the environment, such as
`OPENAI_API_KEY`.  The server creates the agent at the first prompt, so the
page loads and its other tools work without a credential.  A missing
credential appears as an error message in the agent pane.

## The agent pane

The agent pane shows the session status, the model name, and the
conversation.  Send, or Ctrl+Enter in the message box, submits a prompt.
Stop interrupts the current turn, and Reset discards the conversation and
its Pi session.  Reconnect opens a new connection after the server
disconnects, which starts a new session with an empty conversation.

| Role | Entry |
| --- | --- |
| `user` | A submitted prompt |
| `assistant` | The model's text |
| `tool` | A tool call with its arguments |
| `result` | A tool result |
| `error` | A failed tool call or a failed turn |

| Status | Meaning |
| --- | --- |
| `Ready` | The session accepts a prompt |
| `Running` | A turn is in progress |
| `Interrupting` | Stop was requested, and the turn has not ended |
| `Interrupted` | The last turn ended after Stop |
| `Error` | The last turn failed |
| `Connecting`, `Disconnected` | Page-side states of the WebSocket |

## How a request runs

The page sends the prompt with a captured context.  In the workspace example
the context is `{focused: paneId}`, recorded when the user submits.  The
server prefixes the prompt with `Captured request context:` and that JSON, so
the agent resolves phrases such as "this pane" against the pane that had
focus at submission, even if focus changes during the turn.  The server
rejects a prompt while another turn runs.

During the turn, each tool call goes to the page or to the server runtime.
A `smallslop_command` call becomes a page command: the server sends it to the
page over the WebSocket, and the page returns the result or the error
message.  A `smallslop_server` call runs directly in the session's server
runtime.  The turn ends when the model stops calling tools, and the page
receives the final session state as the reply to its prompt.

Stop sends an interrupt.  The server aborts the Pi session, ignores later
events from the aborted turn, and reports `Interrupted`.  Work that a page
command or server command completed before the interrupt remains in effect.
Closing the page cancels pending page commands, aborts the turn, disposes
the Pi session, closes the session's server runtime, and marks the page's
component instances `unavailable`.

## Tools

[`smallslopTools({page, server})`](../server/agent.mjs) returns the three
tool definitions.  Each tool returns its result as JSON text.  A thrown error
becomes a failed tool call that the model sees.

| Tool | Argument | Effect |
| --- | --- | --- |
| `smallslop_state` | none | Sends the page command `{op: 'state'}` and returns the page state |
| `smallslop_command` | `command`: a JSON object as text | Sends the command to the page and returns its result |
| `smallslop_server` | `command`: a JSON object as text | Runs the command in the session's server runtime and returns its result |

The agent has no file, shell, or network tools of its own.  It can still run
JavaScript on the server: the page's `components` command installs and
creates server components, which run in a Node child process with the
server user's permissions.  Treat the agent as able to run code on the
server machine.

## Page commands in the workspace example

The page answers `{op: 'state'}` with its panes, their contents, the
activity log, and this command list.  The agent reads the list from the
state, so a page defines its own commands.  The example's `page.js` defines
the list and passes most commands to
[`ui/workspace.js`](../ui/workspace.js),
[`ui/development.js`](../ui/development.js), and
[`ui/components.js`](../ui/components.js).

| Command | Arguments | Effect |
| --- | --- | --- |
| `state` | none | Read panes, contents, activity, and commands |
| `open`, `close`, `focus`, `enlarge` | `id` | Show, hide, focus, or enlarge a pane |
| `move` | `id`, `x`, `y` | Move a pane, in pixels relative to the workspace |
| `resize` | `id`, `width`, `height` | Resize a pane |
| `send` | `id`, `selector`, `args` | Send a message to a pane's Smallslop object, with [encoded arguments](manual.md#commands-and-values) |
| `browse` | `action`, `value`, and `className` and `selector` for `reveal` | Operate the System Browser |
| `inspect` | Optional `id`, `value`, and `runtime` (`page` or `server`) | Open an object inspector on a pane, an encoded value, or the server `Database` |
| `objectInspector` | `id`, `action`, `value` | Operate an object inspector |
| `debug` | `request` | Run a [JSON debugger request](manual.md#json-debugger-api) in the page runtime |
| `components` | `request` | Send a [component request](components.md#operations) and wait for its result |
| `diskExample` | none | Install the disk-usage components and open their pane |

`browse` actions are `state`, `category`, `class`, `side`, `protocol`,
`method`, `source`, `methodProtocol`, `new`, `accept`, `revert`,
`breakpoint`, `find`, `clearResults`, and `reveal`.  `objectInspector`
actions are `state`, `select`, `page`, `expression`, `evaluate`, `run`,
`resume`, `pause`, `step`, `stepOver`, `stepOut`, `retry`, `cancel`,
`openSelected`, `openResult`, `openClass`, `browse`, `debugger`, and `debug`.
The server also sends the page `componentRuntime` commands, which carry
component requests for the page's browser runtime.

## Server commands

Each session has a [`ServerWorld`](manual.md#server-runtime), a Smallslop
runtime whose `Database` object runs SQL in a separate process.  The agent's
`smallslop_server` tool and the page's server requests accept the same
commands.  SQL results stay in server memory until closed, and a failed SQL
send pauses with its frames retained for repair and retry.

| Command | Arguments | Effect |
| --- | --- | --- |
| `state` | none | Database handle, open results, processes, breakpoints, inspector sessions |
| `schema` | none | Each table, index, and view with its SQL and columns |
| `execute` | `sql`, optional `parameters` | Run one SQL statement and return a result description |
| `next` | `id`, optional `count` | Read the next rows of a result |
| `page` | `id`, `offset`, optional `count` | Read rows from a position |
| `close` | `id` | Close a result |
| `completion` | `processId` | Read the outcome of a process after repair |
| `send` | `target` (`database` or a result ID), `selector`, `args` | Send a message with encoded arguments |
| `inspector` | `action`, `value`, and session fields | Operate a server object inspector |
| `debug` | `request` | Run a JSON debugger request in the server runtime |

Command results report the Smallslop process.  A completed command returns
`value` or a `result` description.  A paused command returns the process
state, which the debugger can inspect, repair, and resume.  SQL parameters
accept JSON strings, numbers, and null, or tagged values such as
`{kind: 'integer', value: '123'}` and `{kind: 'bytes', value: [0, 255]}`.

## Instructions and model selection

The application supplies the system prompt.  The workspace's instructions in
[`examples/workspace.mjs`](../examples/workspace.mjs) describe the panes,
the database, the captured context, the debugger value encoding, the
component commands, and the expected final answer.  `createPiAgent` gives
the session only these instructions: it loads no Pi extensions, skills,
prompt templates, themes, or context files.  It keeps the conversation in
memory and uses Pi's `low` thinking level.

[`server/model-runtime.mjs`](../server/model-runtime.mjs) selects the model.
When Pi's `auth.json` stores credentials, it considers only those providers.
It takes the first available model from this list, and otherwise the first
available model of any name.

| Order | Provider | Model |
| --- | --- | --- |
| 1 | `openai-codex` | `gpt-5.6-sol` |
| 2 | `openai` | `gpt-5.1-codex` |
| 3 | `openai` | `gpt-5` |

## Session protocol

The page and server exchange JSON messages over the WebSocket at
`/api/session`.  [`SessionConnection`](../ui/session-connection.js)
implements the page side.  A request's reply carries its `id`, with either
`result` or `error`.

| Direction | Message | Meaning |
| --- | --- | --- |
| Page to server | `{type: 'prompt', id, message, context}` | Start a turn.  The message has 1 through 32,000 characters.  The reply arrives when the turn ends. |
| Page to server | `{type: 'interrupt'}` | Stop the current turn |
| Page to server | `{type: 'reset', id}` | Discard the conversation.  Rejected during a turn. |
| Page to server | `{type: 'server', id, command}` | Run a server runtime command |
| Page to server | `{type: 'components', id, request}` | Send a request to the component service |
| Page to server | `{type: 'commandResult', id, result}` or `error` | Answer a page command |
| Server to page | `{type: 'session', state}` | Report `id`, `status`, `model`, and `messages` |
| Server to page | `{type: 'command', id, command}` | Run a page command |
| Server to page | `{type: 'reply', id, result}` or `error` | Answer a page request |
| Server to page | `{type: 'error', error}` | Report a malformed message |

The agent's page commands fail after 30 seconds without an answer.  Commands
for the page's component runtime have no time limit.  When the WebSocket
closes, the server fails its pending page commands and the page fails its
pending requests.

## Web server

`createSmallslopServer(options)` returns `{server, components, close()}`.
`server` is a Node HTTP server that the caller starts with `listen`.
`components` is the component service, or `null`.  `close()` ends every
session, stops the HTTP server, and closes the component service.

| Option | Meaning |
| --- | --- |
| `root` | Directory that URL paths resolve against |
| `directories` | Directories under `root` whose files the server serves |
| `index` | URL that `/` redirects to |
| `databasePath` | SQLite file for each session's server runtime, or `:memory:` for a separate database per session |
| `createAgent` | Function that creates a session's agent |
| `components` | Optional `{directory, namespace}` for a [component service](components.md#hosting-components) |

The server answers only `GET`.  It serves files with the extensions `.html`,
`.js`, `.mjs`, `.css`, `.json`, `.svg`, `.png`, and `.jpg` from the listed
directories, and it serves installed component files at
`/components/NAMESPACE/versions/VERSION/FILE`.  It accepts WebSocket
upgrades only at `/api/session`.

`createAgent({page, server, onEvent})` returns, or resolves to, an object
with `model`, `prompt(message, context)`, `interrupt()`, and `dispose()`.
`page(command, signal)` and `server(command, signal)` run commands and
return promises.  `onEvent({role, text})` appends an entry to the
conversation.  `createPiAgent({cwd, instructions, tools, onEvent})` provides
this object for a Pi session.

## Security

A server on a loopback address accepts only the host names `127.0.0.1`,
`localhost`, and `[::1]`, which blocks DNS rebinding from other sites.
Every server rejects a WebSocket whose `Origin` differs from its `Host`.
The server has no authentication.

On a non-loopback address the server accepts any host name.  Anyone who can
reach the port can then use the agent with your Pi credential, run SQL
against the session database, and install and run server components, which
execute JavaScript with the server user's permissions.  Listen on another
address only on a network where every user may do those things.

## Using the agent in another application

A server combines `createSmallslopServer` with `createPiAgent`.  An
application adds its own tools beside `smallslopTools` and writes
instructions that name its page commands.

```js
import { createSmallslopServer } from './smallslop/server/server.mjs';
import { createPiAgent, smallslopTools } from './smallslop/server/agent.mjs';

const root = process.cwd();
const app = createSmallslopServer({
  root, directories: ['smallslop/src', 'smallslop/ui', 'smallslop/components', 'app'], index: '/app/index.html',
  databasePath: `${root}/app.sqlite`,
  createAgent: ({ page, server, onEvent }) => createPiAgent({
    cwd: root, instructions: 'You operate this page. Read smallslop_state first.',
    tools: smallslopTools({ page, server }), onEvent,
  }),
});
app.server.listen(8080, '127.0.0.1');
```

The page connects with `SessionConnection` and answers page commands.  Its
command handler must answer `{op: 'state'}`, because `smallslop_state` sends
that command.

```js
import { SessionConnection } from '../smallslop/ui/session-connection.js';

const connection = new SessionConnection({
  command: request => request.op === 'state' ? describePage() : runCommand(request),
  session: state => showConversation(state),
  error: report,
  open: () => connection.ask('Describe this page.', { focused: null }).catch(report),
});
connection.connect();
```

`open` runs after each connection opens, and requests sent before then
fail.  `ask` resolves with the session state when the turn ends.
`interrupt()`, `reset()`, `server(command)`, and `components(request)` send
the other requests, and `connected` reports whether the WebSocket is open.

## Testing

`npm run test:workspace` starts the server with a test agent in place of Pi.
The test agent calls the real tools, so the test covers the page commands,
the server runtime, the component service, the WebSocket protocol, interrupt,
and reset in Chromium.  No test sends a prompt to a model.

## Limitations

The conversation lives in server memory and ends when the page disconnects
or the server stops.  Each page connection has one agent and one turn at a
time.  A long page command, such as a slow inspector evaluation, fails the
tool call after 30 seconds.
