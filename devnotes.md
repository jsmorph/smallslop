# Smallslop development notes

## 2026-10-16: Copy from Photoslop

This repository takes the Smallslop essentials from `../photoslop` at commit
`d94348e`, and Photoslop stays unchanged.  The essentials are the
interpreter, the browser tools, the component runtime, the Node server
runtime, and a generic Pi agent and Web server.  Photoslop's photo page
supplied the agent and Web server code, and its photo-specific parts stayed
behind.  The user approved the `@earendil-works/pi-coding-agent` 0.83.0
dependency, copying Photoslop's `server/component-store.mjs` for the
component test, and an example page with an agent pane.

### Plan

- [x] Copy `src/`, `ui/`, and `components/` from `../photoslop/smallslop/` unchanged.
- [x] Copy `server/world.mjs`, `sqlite.mjs`, `sqlite-worker.mjs`, and `values.js`, and remove the EXIF extractor from `world.mjs`.
- [x] Copy the counter, repair, and disk-component examples, the tests that do not involve photos or Photoslop, `scripts/browser.js`, `README.md`, `package.json`, and `LICENSE`.
- [x] Copy Photoslop's `server/ws.mjs`, `pi/model-runtime.mjs`, and `server/component-store.mjs` into `server/`.
- [x] Write `server/agent.mjs` from `photos/agent.mjs`: a Pi session with three tools for page state, page commands, and server commands.  The application supplies the instructions.
- [x] Write `server/server.mjs` from `photos/server.mjs`: files from listed directories plus the `/api/session` WebSocket, with a server runtime and an agent for each connection.
- [x] Write `ui/agent-connection.js` from `photos/connection.js`.  `ask` returns a promise, and `interrupt` sends the interrupt message.
- [x] Copy Photoslop's `app/workspace-development.js` to `ui/development.js` with relative imports, and add a `server` option that gives its Debugger a Server selector.
- [x] Write the workspace example: the page in `examples/workspace/` with agent, System Browser, Debugger, object inspector, pane list, and activity panes, and its server in `examples/workspace.mjs`, outside the served directory.
- [x] Add `scripts/test-workspace.mjs`, which drives the example in Chromium with a test agent, and `scripts/cdp-connection.mjs`, copied from the `CdpConnection` class in Photoslop's `server/debug-connection.mjs`.
- [x] Copy the manual to `docs/manual.md` without the photo and Photoslop sections, and update `README.md`.
- [x] Run the tests.
- [x] Commit.

### Test results

`npm test` passes 64 tests.  The 11 tests that Photoslop runs and this
repository omits cover the photo page, EXIF extraction, and two Photoslop
workspace modules.  `npm run test:browser`, `npm run demo`, and
`npm run test:workspace` pass.  The workspace test checks host and path
restrictions, agent page commands, server SQL, a server Database inspector,
the Debugger's Server methods, interrupt, and reset.  The ten Node examples
in `docs/manual.md` run from the repository root.

`createPiAgent` created and disposed a Pi session with
`openai-codex/gpt-5.6-sol` from the stored Pi login.  No test sent a prompt
to a model, so a live agent turn remains untested here.

### Open items

| Item | Detail |
| --- | --- |
| Model preferences | `server/model-runtime.mjs` contains Photoslop's preferred-model list.  The user accepted it. |
| Live agent turn | No test has sent a prompt to a model from this repository. |

## 2026-10-16: Audit, component namespace, and listening address

`npm audit` reported three advisories, all from
`@earendil-works/pi-coding-agent` 0.83.0.  That version pins `undici` 8.5.0,
inside the vulnerable range 8.0.0 through 8.10.1, and `minimatch` 10.2.5,
which installed `brace-expansion` 5.0.7.  Every Pi release from 1.0.0 pins
`undici` 8.10.2 and `minimatch` 10.2.6.  The Pi changelog from 0.84.0 through
1.3.0 lists no breaking change to the APIs that `server/agent.mjs` and
`server/model-runtime.mjs` use: `createAgentSession`,
`DefaultResourceLoader`, `SessionManager`, `SettingsManager`,
`ModelRuntime`, custom tools, and the `text_end` and `tool_execution` events.
The repository now pins Pi 1.3.0, and `npm audit` reports no
vulnerabilities.  All tests pass, and a Pi session starts and closes with
`openai-codex/gpt-5.6-sol`.  Photoslop still uses Pi 0.83.0.

The component identity field `catalog` is now `namespace` in
`components/runtime.js`, `components/values.js`, `components/jobs.js`,
`server/component-store.mjs`, and the component test.  A namespace names the
component store that a runtime, its references, and its installed versions
belong to.  `describeComponentJob` no longer returns `cancelPath`, which
named a Photoslop HTTP route.  These changes alter the component API, so
Photoslop component records and references do not work here unchanged.

The workspace server takes `--host ADDRESS`, with `127.0.0.1` as the
default.  `server/server.mjs` checks the `Host` header only when it listens
on a loopback address, where the check blocks DNS rebinding.  On another
address it accepts any host name, and the WebSocket origin check remains.
The server has no authentication, so a server on all interfaces gives
anyone who can reach the port use of the agent, which runs on the user's
Pi credentials, and of the database.

- [x] Upgrade Pi to 1.3.0 and rerun the audit and tests.
- [x] Rename `catalog` to `namespace` and remove `cancelPath`.
- [x] Add `--host` and restrict the host check to loopback servers.

## 2026-10-16: Documentation review

`README.md` repeats most of the manual's API sections in shorter form, so
the two copies can disagree.  The manual's "Running Smallslop" chapter mixes
commands with the workspace, inspector, and server runtime descriptions.
The manual omits the APIs that a project needs after copying `ui/` or
`server/`, and it does not document `components/`.  Both files contain
history phrasing, scattered "remain pending" notes, broken line wraps, and
an inaccurate sentence about which modules carry debugger operations.

- [ ] Reduce `README.md` to a description, the directory table, setup and commands, the workspace example with its security note, and a link to the manual.  Move any fact found only in the README into the manual.
- [ ] Reorganize the manual: overview; running the examples and tests; language; classes; processes and debugger; JSON debugger API; embedding and bytecode; browser tools; server and agent; components; limitations.
- [ ] Document `createWorkspace`, pane definitions, workspace commands, `createWorkspaceDevelopment`, `createSmallslopServer`, the agent interface, `createPiAgent`, the three tool names, `AgentConnection`, and the example's page commands.
- [ ] Document `components/` and `ComponentStore` from the code and `test/components.test.js`, including that no page in this repository hosts the example components.
- [ ] Collect pending work in the limitations table, and remove history phrasing, test counts, and vague sentences.
- [ ] Check every documented option and command against the code, and run every Node example.
- [ ] Remove test counts and settled items from these notes.
