# Components

A component is a JavaScript module installed as an immutable version and
used through a Smallslop object.  Its manifest names a factory function and
maps Smallslop selectors to the methods of the object that the factory
returns.  Browser components run in a page and can show a view in a pane.
Server components run in a Node child process of the Web server.  Every
message to a component runs as a Smallslop process, so the Smallslop
debugger can pause, inspect, repair, and retry it.

## The disk example

The workspace's Disk example button installs two components from
[`examples/components/`](../examples/components/) and opens a pane.
[`disk-reader.mjs`](../examples/components/disk-reader.mjs) runs on the
server and reads file-system statistics for a configured path.
[`disk-pane.mjs`](../examples/components/disk-pane.mjs) runs in the page,
holds a binding to a disk reader, and shows its used, free, and available
bytes when the user selects Refresh.

```js
import { encode } from '../../components/values.js';

const reader = await components.run({ op: 'modules.install', files: { 'index.mjs': readerSource },
  manifest: { name: 'disk-reader', target: 'server',
    interface: { className: 'DiskReader', messages: { usage: { method: 'usage', arity: 0 } } } } });
const disk = await components.run({ op: 'objects.create', runtime: 'server',
  version: reader.version, configuration: encode({ path: '/' }) });
const view = await components.run({ op: 'modules.install', files: { 'index.mjs': paneSource },
  manifest: { name: 'disk-pane', target: 'browser', bindings: { disk: ['usage'] },
    interface: { className: 'DiskPane', messages: {
      refresh: { method: 'refresh', arity: 0 }, state: { method: 'state', arity: 0 } } } } });
const display = await components.run({ op: 'objects.create', runtime: components.identity.runtime,
  version: view.version, configuration: encode({}), bindings: { disk: disk.reference } });
await components.run({ op: 'panes.open', target: display.reference, title: 'Disk usage' });
```

`components` is the object that
[`createWorkspaceComponents`](#browser-runtime) returns, and the example
page's `openDiskExample` function runs these steps.  The pane's Refresh
button starts a `refresh` call on the browser instance.  That method sends
`usage` to the server instance through its `disk` binding and renders the
reply.  The agent runs the same steps with the `diskExample` page command or
with `components` page commands.

## Modules and manifests

`modules.install` takes a manifest and a map of file names to source text.
The store normalizes the manifest, hashes it with the files, and saves them
under the SHA-256 hash, which becomes the version ID.  Installing the same
manifest and files again returns the same version.  Loading a version
recomputes the hash and rejects files that differ from it.

| Manifest field | Meaning |
| --- | --- |
| `name` | Lowercase letters, digits, and hyphens, starting with a letter |
| `target` | `browser` or `server` |
| `entry` | Entry file, default `index.mjs` |
| `factory` | Exported factory function, default `create` |
| `interface.className` | Smallslop class name, starting with a capital letter |
| `interface.messages` | Map from selector to message declaration |
| `bindings` | Map from binding name to the selectors its target must publish |
| `dependencies` | Version IDs that must already be installed |
| `smallslop` | Saved wrapper methods: `{category, methods: [{source, protocol}]}`.  Save writes this field. |

| Message field | Meaning |
| --- | --- |
| `method` | JavaScript method name on the component object |
| `arity` | Argument count, 0 through 16, matching the selector |
| `result` | `data`, the default, copies the result.  `reference` requires a registered component object and returns its reference. |
| `context` | `true` passes a [call context](#jobs-and-call-context) after the arguments |
| `description` | Text stored with the message and returned in instance descriptions |

File names are relative paths of letters, digits, dots, underscores, and
hyphens.  A browser module can import other files of its version by relative
path and any file the Web server serves by absolute URL path.  A server
module is imported from the store directory and can import Node's built-in
modules.

## Factories and context

The factory receives the decoded configuration and a context, and it returns
the component object or a promise for it.  The runtime checks that the object
has every declared method.  It then creates a Smallslop wrapper object whose
class publishes the declared selectors.

| Context member | Use |
| --- | --- |
| `self` | This instance's reference |
| `binding(name)` | The current target reference of a declared binding |
| `send(reference, selector, args, options)` | Send a message and resolve to its decoded result.  `args` is an array of ordinary values. |
| `observe(name, listener)` | Call `listener` with the binding target's description now and after each change.  The target must be in the same runtime. |
| `action(selector, options)` | Return an event handler that starts a call with no arguments |
| `signal` | An abort signal that fires when the instance is disposed |
| `own(cleanup)` | Register cleanup to run at disposal |
| `task(promise)` | Track work that the instance started outside a message |
| `operation(promise, cancel)` | Return a host operation that the debugger can cancel |
| `changed()` | Advance the instance revision and notify observers |
| `report(error)` | Record an error on the instance and report it to the page |

`send` and `action` accept `{releaseOnSuccess: true}`, which releases a
call after it completes without error, pause, or debugger retention.  Calls
started without that option stay in the call registry until released.

A browser component's object can define `mount(root)`, which builds its view
inside a pane, and optional `visibility(shown)` and `dispose()` methods.  Any
component can define `snapshot()` and `restore(state)` to save declared
state, as described under [Saving](#saving-source-and-state).

## Wrappers, messages, and calls

The wrapper class is named from the class name and version, for example
`DiskPaneV` followed by the version ID, in the category `Components`.  Each
published selector has a source method in the `published messages` protocol
that forwards to a generated primitive.  The System Browser shows browser
wrapper classes, and its edits and breakpoints apply to later calls.  Save
records edited wrapper methods in the new version's manifest.

`objects.send` starts a call: a Smallslop process that sends the selector to
the wrapper with the decoded arguments.  The reply describes the call after it
completes, pauses on an error, or is cancelled.  A call paused at a breakpoint
keeps its request running until the call resumes.  The call stays in the
registry with its process, so the debugger can inspect or retry it, until
`calls.release` removes it.

| Call field | Meaning |
| --- | --- |
| `id`, `processId` | Call ID and its Smallslop process |
| `target`, `version`, `selector`, `args` | What the call sent |
| `status` | `running`, `waiting` for a JavaScript promise, `paused`, `completed`, or `cancelled` |
| `execution` | State of the JavaScript method: `pending`, `running`, `completed`, or `failed` |
| `result`, `error` | Encoded result, or the error |
| `retained` | The call paused, was inspected, or was retained, so a release with `ifSuccessful` keeps it |
| `job`, `progress`, `publishing` | Job label and input, latest progress, and publication state |

`calls.cancel` cancels the call's process and aborts its call context.
JavaScript work that ignores the abort signal continues until it settles,
and the instance counts that work as active.  `calls.retain` keeps a call
through completion, and `calls.release` with `ifSuccessful: true` releases
it only after a clean completion.

## Instances and references

A runtime identity has a `namespace`, a `runtime` name, and an
`incarnation`.  The server runtime is named `server`, and each page's runtime
is named `browser-` followed by a random ID.  A reference adds the instance
`id`.  A new page load or a server child restart creates a new incarnation,
and references to an earlier incarnation fail.

| Instance status | Meaning |
| --- | --- |
| `constructing` | The factory is running |
| `ready` | The instance accepts messages |
| `failed` | Construction or disposal failed.  `error` describes it. |
| `snapshotting` | Save is reading its state |
| `disposing`, `disposed` | Disposal is running or finished |
| `unavailable` | The instance's runtime disconnected or restarted |

An instance description also lists its configuration, bindings with their
revisions, published messages, active calls, active processes, host tasks,
pane, and saved snapshot ID.  `objects.dispose` requires an idle instance
with no mounted pane and no consumer bindings, and then calls the object's
`dispose()` method.

## Values

Configuration, arguments, results, and saved state use tagged JSON records.
`encode` and `decode` in [`components/values.js`](../components/values.js)
convert between JavaScript values and these records.

| JavaScript value | Encoding |
| --- | --- |
| `null` | `{kind: 'nil'}` |
| `undefined` | `{kind: 'undefined'}` |
| BigInt | `{kind: 'integer', value: '9007199254740993'}` |
| Number | `{kind: 'float', value: 2.5}`, or the strings `'-0'`, `'NaN'`, `'Infinity'`, and `'-Infinity'` |
| Boolean, string | `{kind: 'boolean', value: true}`, `{kind: 'string', value: 'text'}` |
| `Uint8Array` | `{kind: 'bytes', value: [0, 255]}` |
| Array | `{kind: 'array', value: [...]}` |
| Plain object | `{kind: 'record', value: {...}}` |
| Registered component object | `{kind: 'reference', value: reference}` |

Encoding copies own data fields.  It rejects cycles, accessor properties,
symbol keys, and objects other than plain records and arrays.  A value may
encode to at most 1 MiB and nest at most 32 levels.

## Bindings

A manifest's `bindings` declare names and required selectors.
`objects.create` supplies a reference for each declared name, and the target
must be ready and publish the required selectors.  The target can be in
another runtime: the browser disk pane binds to the server disk reader.
`context.binding(name)` returns the current target.

`bindings.reconnect` replaces a binding's target.  It takes `target`, `name`,
`expectedRevision`, `expectedTarget`, and `replacement`, and fails when the
instance is busy or the binding changed since the caller read it.  An
observed binding requires a replacement in the same runtime.

## Panes

Browser instances with a `mount` method can occupy panes.  These operations
run in the page's browser runtime.

| Operation | Arguments | Effect |
| --- | --- | --- |
| `panes.open` | `target`, optional `title`, `bounds`, `association`, `id` | Mount the instance in a new pane, or show its existing pane |
| `panes.replace` | `id`, `target`, `expectedTarget`, `expectedRevision` | Mount another idle instance in the pane |
| `panes.discard` | `id`, `expectedRevision` | Dispose the instance and remove the pane |
| `panes.list` | none | Component panes with targets and revisions |
| `panes.inspect` | `target` | Open an object inspector on an instance in this page or the server |

Closing a pane hides it and keeps the instance.  A replacement prepares the
new view off screen and keeps the old view when preparation fails.

## Jobs and call context

`jobs.start` starts a call on a server instance and records it as a job.  It
takes `target`, `selector`, `args`, and optional `label` and `input` record,
and returns the job record.  `jobs.list`, `jobs.inspect` with `id`, and
`jobs.cancel` with `id` read and cancel jobs.  The service keeps active jobs
and recent finished ones.

| Job field | Meaning |
| --- | --- |
| `id`, `title`, `namespace` | Call ID, label, and namespace |
| `status` | `running`, `paused`, `cancelling`, `cancelled`, `error`, `done`, or `unknown` |
| `active`, `canCancel` | Whether the job is unfinished and whether it accepts cancellation |
| `input`, `progress`, `error` | Supplied input, latest progress, and error message |
| `call` | Target, version, selector, arguments, process, execution state, and encoded result |

A message declared with `context: true` receives a call context after its
arguments.  `signal` aborts when the call is cancelled.  `setProgress(record)`
stores a progress record of at most 4 KiB.  `beginPublication()` marks the
start of persistent output, after which cancellation is refused.  `call`
holds the call's ID, target, version, selector, arguments, and job input.

## Saving source and state

`objects.save` with `target` saves an idle instance.  It installs a version
whose manifest includes the wrapper class's current methods, and it stores a
snapshot of the version, the configuration, and the result of the object's
`snapshot()` method, if present.  A component with `snapshot()` must also
define `restore(state)`.  The reply is the instance description with its
`savedSnapshot` ID.

`objects.create` with `snapshot` creates an instance from a saved snapshot:
the runtime constructs the object and calls `restore(state)` before the
instance accepts messages.  Bindings are supplied again at creation.
`objects.source` returns an instance's current manifest and files.
`snapshots.list` and `snapshots.read` with `id` read saved snapshots.

## Requests and the client

The component service runs most operations as requests.  A request has an ID
reserved in advance, runs in the background, and keeps its outcome after it
finishes.  Submitting the same ID and arguments again returns the existing
request, so a client can repeat a submission after a lost reply.

| Request status | Meaning |
| --- | --- |
| `reserved` | The ID exists, and no request has used it |
| `running` | The operation is in progress |
| `completed`, `failed` | The operation finished with `result` or `error` |
| `unknown` | The target runtime disconnected, so the outcome is unknown |

[`ComponentClient`](../components/client.js) wraps a request function.
`submit(request)` reserves an ID and submits the request.  `run(request)`
submits it and waits for its outcome, and throws the request's error.
`requests.wait` with `id` and `revision` returns when the request changes or
after 25 seconds.  `requests.release` removes a finished request.

## Operations

A request's `runtime` names the runtime that runs it.  `page` means the
requesting page's browser runtime.  Operations with a `target` run in the
target's runtime.

| Operation | Arguments | Result |
| --- | --- | --- |
| `runtimes.describe` | none | Namespace, limits, and each runtime's status and debugger state |
| `runtimes.register` | `identity` | Registers the page's browser runtime |
| `runtimes.restart` | `expectedIncarnation` | Restarts the server child process |
| `modules.install` | `manifest`, `files` | Version description with `version` and `url` |
| `modules.list`, `modules.source` | `version` for `source` | Installed versions, or one version with its files |
| `modules.load`, `modules.loaded` | `runtime`, `version` for `load` | Load a version into a runtime, or list loaded versions |
| `objects.create` | `runtime`, `version` or `snapshot`, `configuration`, `bindings` | Instance description |
| `objects.list` | `runtime` | Instance descriptions |
| `objects.inspect` | `target` | Instance description |
| `objects.consumers` | `target` | Instances with a binding to the target |
| `objects.send` | `target`, `selector`, `args` | Call description |
| `objects.fields` | `target`, optional `offset`, `limit` | The JavaScript object's fields |
| `objects.inspector` | `target` | Object inspector state for a server instance |
| `objects.source`, `objects.save`, `objects.dispose` | `target` | Source, saved description, or disposed description |
| `bindings.reconnect` | `target`, `name`, `expectedRevision`, `expectedTarget`, `replacement` | Instance description |
| `calls.list`, `calls.inspect` | `runtime` or `target`, and `id` for `inspect` | Calls, or one call with its process state |
| `calls.cancel`, `calls.retain`, `calls.release` | `runtime` or `target`, `id`, and optional `ifSuccessful` for `release` | Call description or release result |
| `jobs.start`, `jobs.list`, `jobs.inspect`, `jobs.cancel` | See [Jobs](#jobs-and-call-context) | Job records |
| `snapshots.list`, `snapshots.read` | `id` for `read` | Saved snapshots |
| `panes.open`, `panes.replace`, `panes.discard`, `panes.list`, `panes.inspect` | See [Panes](#panes) | Pane descriptions |
| `debug.smallslop` | `runtime` or `target`, and a debugger `request` | Debugger response |
| `debug.javascript` | `runtime`, and `action: 'state'` or a `method` and `params` | JavaScript debugger response |
| `debug.attach`, `debug.detach` | `runtime`, and `incarnation`, `endpoint`, `targetId` for `attach` | Browser debugger state |
| `requests.reserve`, `requests.submit`, `requests.inspect`, `requests.wait`, `requests.release` | See [Requests](#requests-and-the-client) | Request records |

## Debugging

A component call is an ordinary Smallslop process.  A breakpoint in a
wrapper method pauses the call, and a JavaScript exception pauses it at the
send with its operands intact.  The Components pane's Debug button retains a
call and opens its process in the Debugger pane.  `debug.smallslop` sends a
[JSON debugger request](manual.md#json-debugger-api) to a runtime's
debugger, including the server runtime.

The server process starts Node's inspector on a loopback port, and the
service connects to it.  `debug.javascript` with `runtime: 'server'` sends
`Debugger.` and `Runtime.` protocol methods, such as
`Debugger.setBreakpointByUrl`, `Debugger.evaluateOnCallFrame`, and
`Debugger.resume`.  `action: 'state'` lists the component scripts and the
paused frames.  A JavaScript breakpoint pauses the whole child process, and
the Web server and its sessions keep running.

A browser runtime's JavaScript is debugged through the browser's DevTools
protocol.  `debug.attach` takes the runtime name, its incarnation, the
browser's debugging endpoint, and the page's target ID.  The service checks
that `globalThis.smallslopComponents.identity` in the target page matches
the runtime before it accepts the attachment.

## The Components pane

The Components pane lists the page's browser instances with their status,
version, errors, and calls.

| Action | Effect |
| --- | --- |
| Inspect | Open an object inspector on the instance's wrapper |
| Show | Show the instance's pane |
| Methods | Show the wrapper class in the System Browser |
| JavaScript | Inspect the installed source files |
| Save | Save the instance's source and state |
| Export source | Download the current manifest and files as JSON |
| Inspect binding | Open an inspector on a binding's target |
| Debug | Retain a call and open its process in the Debugger |
| Release | Release a finished call |

## Hosting components

`createSmallslopServer` creates a
[`ComponentService`](../server/component-service.mjs) when it receives
`components: {directory, namespace}`.  The directory holds the store, and
the namespace is part of every identity and component URL.  The service
starts the server child process at the first server operation, routes each
request to its runtime, and records server instances and jobs.

| Store path | Contents |
| --- | --- |
| `versions/VERSION/` | Installed files and `manifest.json` |
| `snapshots/ID/record.json` | Saved snapshots |

The Web server routes each page's `{type: 'components'}` messages to the
service with a page handle.  The service sends that page's runtime the page
command `{op: 'componentRuntime', identity, request}`.  The page passes
these commands to `components.command(request)`.  When a page disconnects,
its runtime's instances become `unavailable`.

### Browser runtime

`createWorkspaceComponents({workspace, development, request, namespace})` in
[`ui/components.js`](../ui/components.js) creates a page's browser runtime.
`workspace` comes from `createWorkspace`, `development` from
`createWorkspaceDevelopment`, and `request` sends a request to the service,
for example `value => connection.components(value)`.  The namespace comes
from `runtimes.describe`.  The function adds the Components pane.

| Member | Use |
| --- | --- |
| `identity` | The page runtime's identity |
| `connect()` | Register the runtime with the service.  Call it after each WebSocket connection opens. |
| `run(request)` | Submit a request and wait for its result |
| `request(request)` | Send a request directly, for discovery and request records |
| `command(request)` | Handle a `componentRuntime` page command |
| `runtime`, `client`, `execute`, `panes` | The `ComponentRuntime`, the `ComponentClient`, local operation dispatch, and pane records |

[`ComponentRuntime`](../components/runtime.js) also runs without a page.  Its
constructor takes `namespace`, `name`, `source` (a function that returns a
version's source with a `loadUrl`), and `remote` (a function that sends
requests to other runtimes), with optional `incarnation`, `host`, `debugger`,
`changed`, `failed`, `maxActive`, and `maxCalls`.  `register` adds an existing
JavaScript object with declared messages and a pre-made wrapper.  The
[component tests](../test/components.test.js) construct runtimes this way.

## Limits

| Item | Limit |
| --- | --- |
| Encoded value or request | 1 MiB |
| Value nesting | 32 levels |
| Messages per manifest | 128 |
| Files per module | 128 |
| Active calls per runtime | 256, set by `maxActive` |
| Retained calls per runtime | 1,024, set by `maxCalls`.  Release calls to start more. |
| Running requests | 256 |
| Retained finished requests | 1,024 |
| Job label and input | 64 KiB |
| Progress record | 4 KiB |

Instances last until disposal or the end of their runtime.  A page reload
ends its browser runtime, and a server child restart ends every server
instance.  Loaded module code stays cached in its runtime until that runtime
ends.  This repository does not restore instances after a reload: create
them again, or create them from saved snapshots.

## Tests

`npm test` runs [`test/components.test.js`](../test/components.test.js),
which covers values, the store, calls, failures, cancellation, request
repetition, bindings, registered objects, observation, release, and
saving, and
[`test/component-service.test.js`](../test/component-service.test.js),
which runs a server component in the child process.  `npm run
test:workspace` installs the disk example in Chromium, refreshes its pane,
and lists the page's instances through an agent page command.
