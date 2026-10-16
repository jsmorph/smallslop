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
- [x] Add `scripts/test-workspace.mjs`, which drives the example in Chromium with a test agent, and `scripts/cdp-connection.mjs`, copied from the `CdpConnection` class in Photoslop's `server/debug-connection.mjs`.  The component work later replaced it with the whole `server/debug-connection.mjs`.
- [x] Copy the manual to `docs/manual.md` without the photo and Photoslop sections, and update `README.md`.
- [x] Run the tests.
- [x] Commit.

### Test results

The Node tests, the counter and repair browser tests, the repair demo, and
the workspace test pass.  The Photoslop tests left out of this repository
cover the photo page, EXIF extraction, and two Photoslop workspace modules.
The Node examples in the manual run from the repository root.

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

## 2026-10-16: Components in the workspace

The user asked for the example components in the workspace page.  The
component service, server child process, and browser component code come
from Photoslop's `server/component-service.mjs`,
`server/component-process.mjs`, `server/component-child.mjs`,
`server/debug-connection.mjs`, and `app/workspace-live-components.js`.
Photoslop selects a catalog and reaches pages through its command channel.
Here the service receives a page handle for each WebSocket session instead.

| Decision | Reason |
| --- | --- |
| Component requests travel as `{type: 'components'}` session messages | The session already identifies the page, so registration needs no page ID |
| One service per Web server, shared by all pages | Server instances and jobs outlive a page, as in Photoslop |
| The service sends `{op: 'componentRuntime'}` page commands | Agent `components` commands use another name on the same channel |
| The example store is `.local/components`, ignored by Git | Installed versions persist across server restarts |
| Reload restoration and Photoslop workspace objects were left out | Both depend on Photoslop's saved workspace records |
| Job records drop `result.source`, `referenceSource`, and `filename` | Those fields described Photoslop image outputs.  `call.result` keeps the encoded result. |
| The page publishes `globalThis.smallslopComponents.identity` | `debug.attach` verifies the target page with it |
| `AgentConnection` became `SessionConnection` | The connection carries prompts, page commands, server commands, and component requests |

The workspace test installs the disk example, refreshes its pane, and lists
the page's instances through an agent page command.
`test/component-service.test.js` runs the disk reader in the server child
process without a browser.  Both tests run with `npm test` and
`npm run test:workspace`.

## 2026-10-16: Documentation review

`README.md` repeats most of the manual's API sections in shorter form, so
the two copies can disagree.  The manual's "Running Smallslop" chapter mixes
commands with the workspace, inspector, and server runtime descriptions.
The manual omits the APIs that a project needs after copying `ui/` or
`server/`, and it does not document `components/`.  Both files contain
history phrasing, scattered "remain pending" notes, broken line wraps, and
an inaccurate sentence about which modules carry debugger operations.

- [x] Reduce `README.md` to a description, the directory table, setup and commands, the workspace example with its security note, and a link to the manual.  Move any fact found only in the README into the manual.
- [x] Reorganize the manual into language, classes, processes and debugger, JSON debugger API, embedding and bytecode, browser tools, server runtime, and unimplemented features.  The agent and components have their own documents.
- [x] Document `createWorkspace`, pane definitions, workspace commands, `createWorkspaceDevelopment`, `createSmallslopServer`, the agent interface, `createPiAgent`, the three tool names, `SessionConnection`, and the example's page commands.
- [x] Write a full component guide in `docs/components.md`, and host the example components in the workspace page.
- [x] Write `docs/agent.md` for the agent, the Web server, and the session protocol.
- [x] Collect pending work in the unimplemented features table, and remove history phrasing, test counts, and vague sentences.
- [x] Check every documented option and command against the code, and run every Node example.
- [x] Remove test counts and settled items from these notes.

## 2026-10-16: Review fixes

Three reviews covered the server code, the browser code and tests, and the
documentation.  The user approved fixing every finding and stopping the
server until the crash is fixed.

- [x] Handle socket errors on rejected upgrades, so a reset connection cannot crash the server.
- [x] Limit WebSocket message size, reject unmasked and malformed frames, ignore frames after close, and close connections whose unsent output exceeds a limit.
- [x] Let a page's component runtime register again from a new connection, and answer page commands on the socket that delivered them.
- [x] Send structured errors in both directions of the session protocol.
- [x] Answer the component service's read operations both directly and as requests.
- [x] Release successful disk example calls, and reuse the disk example pane.
- [x] Fix the lesser defects: shutdown address check, HTTP statuses, concurrent restart and attach, disconnected server inspectors, agent pane and Components pane redraws, failed mounts, saved arrangement of later panes, and the service's instance records.
- [x] Send conversation entries one at a time in the session protocol.
- [x] Add tests for each fix except the shutdown address check, deadlines for the polling loops, and a stronger System Browser assertion.  A test of that check needs an upgrade request on a connection that survives `server.close()`, and Node closes idle connections there.
- [x] Correct the documentation findings and the style findings.

| Decision | Reason |
| --- | --- |
| A rejected upgrade's socket destroys itself on error | Node removes its own socket error handler before `upgrade`, and a reset from the peer needs only cleanup |
| WebSocket messages are limited to 2 MiB and unsent output to 16 MiB, both options of `acceptWebSocket` | Component requests are limited to 1 MiB, so 2 MiB leaves room for the envelope |
| A matching runtime name and incarnation from a new connection replaces the old page handle | Both values are random, so only the same page knows them |
| Errors cross the session protocol as `errorData` records | Component errors carry `phase`, `component`, and `outcomeUnknown` |
| The session sends `session` once, then `status` and `message` updates | Resending every entry on each update grew with the square of the conversation length |
| `package.json` requires Node 24.2 | `examples/workspace.mjs` uses `import.meta.main` |

The headline of pushed commit `7181993` has 60 characters, and the user's
rule requires fewer.  Changing it requires rewriting published history.  The
user chose to leave it.

## 2026-10-16: Language features

The user approved this plan.  The reference is the ANSI Smalltalk draft,
revision 1.9 (NCITS J20, December 1997), with Smalltalk-80 messages where ANSI
defines none.  Pharo extensions are excluded.

| Decision | Choice |
| --- | --- |
| Symbols | Distinct, interned `Symbol` objects (ANSI §3.4.6.4) |
| Characters | A `Character` class with one interned object per code point.  Strings index UTF-16 code units. |
| Strings | Immutable JavaScript strings, conforming to `<readableString>`.  Text is built with `,`, copies, and `WriteStream`. |
| Exceptions | ANSI §5.5 in full.  An unhandled `Error` suspends the process for the debugger (§5.5.14.1). |
| Class definition and files | The ANSI interchange format (§4), one file per class, with categories and protocols in annotations |
| Changed slots | A missing slot reads as `nil`, and redefinition recompiles dependent methods |
| Arithmetic | Integer `/` returns a `Fraction`.  Integers and fractions mix exactly; Float operands still need `asFloat`. |

Metaclasses move before the collection classes, because class-side
constructors such as `Array new: 3` need them.

- [x] 1. Run-time class lookup, the ANSI `<Object>` protocol, and class reflection.
- [x] 2. Symbols, characters, cascades, literal arrays, and radix integers.
- [ ] 3. Metaclasses.
- [ ] 4. Strings, collections, streams, `printString`, `to:do:`, and fractions.
- [ ] 5. The interchange format: file in and file out, class definition in the System Browser, and directory loading in Node.
- [ ] 6. Exceptions.
