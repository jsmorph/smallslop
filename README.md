# Smallslop

Smallslop is a Smalltalk-like language implemented as a bytecode interpreter
in JavaScript.  It runs in browsers and Node, keeps every call frame
inspectable, and provides a debugger that can step, edit bindings, replace
methods, and retry failed sends.  The repository also contains browser
development tools, a Node server runtime with a SQLite database, a Pi agent
that operates a page, and a runtime for installed JavaScript components.
Smallslop uses the [MIT License](LICENSE).

<img width="1309" height="884" alt="image" src="https://github.com/user-attachments/assets/9d0f82e6-b4d5-47af-a04f-a8671967005d" />


## Using Smallslop in a project

A project uses Smallslop by copying directories into its own tree.  The
directories use relative imports and require no build step.  Copy a directory
together with the directories it imports.

| Directory | Contents | Runs in | Imports |
| --- | --- | --- | --- |
| [`src/`](src/) | Interpreter, compiler, debugger, primitives, source loading, host interface, inspectors | Browser, Node | none |
| [`smalltalk/`](smalltalk/) | Smallslop source, one interchange file per class: class library, exceptions, and tool classes | Read by the runtimes | none |
| [`ui/`](ui/) | Pane workspace, System Browser, Debugger, object inspectors, component panes, session connection | Browser | `src/`, `components/`, and `smalltalk/` through its server |
| [`components/`](components/) | Component runtime, manifests, value encoding, requests | Browser, Node | `src/` |
| [`server/`](server/) | Server runtime and database, Web server, Pi agent, component service | Node | `src/`, `components/`, and `@earendil-works/pi-coding-agent` in `agent.mjs` and `model-runtime.mjs` |
| [`examples/`](examples/) | Counter page, scripted repair, disk-usage components, agent workspace | Browser, Node | the directories above |

## Setup and commands

The code requires Node 24.2 or later, which provides `node:sqlite` and
`import.meta.main`.  The browser tests require Chromium as `chromium` on
`PATH` or as the executable named by the `CHROMIUM` environment variable.  Run
`npm install` once, then use these commands from the repository root:

| Command | Result |
| --- | --- |
| `npm test` | Run the Node tests |
| `npm run demo` | Run the debugger repair example in Node |
| `npm run serve` | Serve the counter and scripted repair pages |
| `npm run test:browser` | Test the counter and repair pages in Chromium |
| `npm run workspace` | Serve the agent workspace |
| `npm run test:workspace` | Test the agent workspace in Chromium with a test agent |

## Agent workspace

`npm run workspace` starts the [workspace example](examples/workspace/page.js)
and prints its URL.  The page contains movable panes for an agent
conversation, the System Browser, the Debugger, object inspectors, and
installed components.  The agent operates the same objects as the user through
page commands, a server Smallslop runtime with a SQLite database, and the
component service.  The Disk example button installs a server component and a
browser component and opens their pane.  Every runtime saves each change to a
class to that class's file in [`smalltalk/`](smalltalk/), and the other
runtimes load the new file.

The agent requires a Pi model credential.  The server listens on `127.0.0.1`
by default and has no authentication.  On another address, anyone who can
reach the port can use the agent with your credential and can run JavaScript
on the server through the component service.

## Documentation

| Document | Subject |
| --- | --- |
| [Smallslop Manual](docs/manual.md) | Language, classes, processes, debugger, embedding, browser tools, server runtime |
| [Agent and Web Server](docs/agent.md) | Workspace server, session protocol, agent tools and commands, model selection, security |
| [Components](docs/components.md) | Component modules, instances, messages, panes, jobs, saving, debugging, hosting |
| [Development Notes](devnotes.md) | Decisions, test results, and plans |
