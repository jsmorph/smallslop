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
| `npm audit` | Reports high-severity advisories in `brace-expansion` and `undici` installed by `@earendil-works/pi-coding-agent` 0.83.0.  Photoslop uses the same version. |
| Component identity | `components/` and `server/component-store.mjs` name the identity field `catalog`, a Photoslop term.  Renaming it changes the component API. |
| Model preferences | `server/model-runtime.mjs` contains Photoslop's preferred-model list. |
