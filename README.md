# Smallslop

Smallslop is a JavaScript-hosted Smalltalk-like interpreter with explicit
execution contexts and a programmatic debugger.  The interpreter and browser
tools use standard ES modules and have no package dependencies.  The
[Smallslop manual](docs/manual.md) covers running the interpreter, the source
language, classes, debugger operations, JSON commands, and bytecode, with
executable examples.

Other projects can use Smallslop by copying its directories.  Every import is
relative, and each directory imports only the directories listed in this
table.  A project copies the directories it needs, with no build step.

| Directory | Contents | Runs in | Imports |
| --- | --- | --- | --- |
| `src/` | Interpreter, compiler, debugger, host interface, inspectors | Browser, Node | none |
| `ui/` | Pane workspace, System Browser, object inspector and Debugger views, agent connection | Browser | `src/` |
| `components/` | Runtime for versioned JavaScript components | Browser, Node | `src/` |
| `server/` | Server runtime with a SQLite database, Web server, Pi agent, component store | Node | `src/`, `components/`, and `@earendil-works/pi-coding-agent` in `agent.mjs` and `model-runtime.mjs` |
| `examples/` | Counter page, scripted repair, disk-usage component, workspace with an agent | Browser, Node | the directories above |

The [workspace example](examples/workspace/page.js) contains movable panes, an
agent conversation, the System Browser, the Debugger, and object inspectors.
The agent operates the same objects and debugger as the user, through page
commands and a server Smallslop runtime with a SQLite database.  It runs with
`npm run workspace` and requires a Pi model credential.  The [workspace
instructions](docs/manual.md#workspace-and-agent) describe the Web server and
its WebSocket protocol.

## Development

Run the tests from the repository root after `npm install`:

```sh
npm test
npm run demo
npm run test:browser
npm run test:workspace
npm run serve
npm run workspace
```

The Node tests use `--expose-gc` and `--test-isolation=none` to test method
lifetimes in the test runner process.  The browser tests require `chromium`
on `PATH`, or an executable selected by `CHROMIUM`.  The counter example
server prints its local URL and serves a snapshot of the source files loaded
at startup.  The workspace test uses a test agent in place of Pi, so it needs
no model credential.

The counter page contains two independent counters, a debugger, and a method
editor.  It exercises captured callbacks, frame and operand edits, live method
replacement, missing-method repair, asynchronous calls, cancellation, and
disposal.  The [browser instructions](docs/manual.md#using-the-browser)
describe the controls.  The linked [scripted repair page](examples/repair.html)
preserves the earlier demonstrations.

The counter browser test drives the page controls and serialized debugger
commands.  It checks both objects' state, suspended frames, DOM output,
asynchronous results, and twenty create/remove cycles.  The page exposes
`smallslop.dispatch(request)` in the console for agent commands.

The interpreter accepts source methods and validated bytecode.  The host
interface supports properties, calls, event callbacks, and asynchronous
waiting with cancellation.  Saved interpreter images remain pending.
Integer values use JavaScript `BigInt`.  Float values use JavaScript `Number`.

## Runtime API

```js
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const counter = runtime.defineClass('Counter', { slots: ['count'] });
runtime.installSource(counter, 'count: value count := value. ^count');
const object = runtime.newObject(counter);
const process = runtime.start(object, 'count:', [42n]);
const state = runtime.run(process);
console.log(state.status, state.result);
```

Classes own method dictionaries.  Instances own named slots initialized to
`null`, the representation of `nil`.  Method lookup follows the superclass
chain.  Installed methods are immutable versions.  An active invocation keeps
its version after replacement.  The method ID index uses weak references.
Classes, frames, blocks, breakpoints, and explicit debugger retention keep
their method versions available for inspection.

Class definitions currently use the JavaScript API.  Ordinary classes support
`new`.  Native value classes require their respective value constructors.
Per-class metaclasses and instance-layout migration remain pending.

A `Code` object contains immutable instruction bytes, literal references,
argument and local names, source, and source positions.  Its constructor
checks instruction boundaries, branches, literals, and operand-stack depth
along reachable paths.  Literal object references retain their identity.
Lexical reads and writes identify an enclosing environment and binding index.
Blocks retain shared bindings and the enclosing method activation.

## Source language

Methods use unary, binary, or keyword selectors.  Unary messages bind before
binary messages, which bind before keyword messages.  Binary messages
associate from left to right.  Parentheses group expressions.  A method
returns its receiver unless it executes an explicit `^` return.

Arguments and `| local names |` declarations introduce lexical bindings.
`:=` assigns a binding or instance slot.  A block uses `[statements]` or
`[:argument | statements]`, with optional local declarations after its
arguments.  Blocks return their final expression.  `^` inside a block returns
from the enclosing method.  An empty block returns `nil`.

The compiler supports integer and decimal/exponent float literals,
single-quoted strings with doubled quotes, double-quoted comments, `self`,
`super`, `nil`, `true`, and `false`.  A class name resolves to the runtime's
class object.  Unknown names and invalid syntax produce `SyntaxError` with
offset, line, and column.  Cascades, symbols, literal arrays, and package
syntax remain pending.

`runtime.evaluate(source)` creates a paused process that returns the final
expression's value.  `runtime.evaluate(source, {processId, frameId})` creates
a separate process sharing the selected paused frame's receiver and lexical
bindings.  Omitting `frameId` selects the current frame.  Evaluation has its
own return activation and leaves the original process paused.

## Initial library

Integer and Float each support `+`, `-`, `*`, `<`, `<=`, `>`, `>=`, `negated`,
`asFloat`, and `asString`.  Arithmetic and ordering require operands of the
same class.  `asFloat` converts an Integer to a Float and can lose precision.
For example, `2 asFloat + 0.5` returns the Float `2.5`.

Integer `quo:` truncates division toward zero.  `rem:` uses that quotient to
compute the remainder.  Zero divisors suspend with an error.  Integer `/` and
fractions remain pending.  Float `/` follows JavaScript Number division,
including infinities and NaN.  Float `truncated` returns an exact Integer for
the float's integer part and rejects infinities and NaN.

Boolean methods include `not`, `ifTrue:`, `ifFalse:`, `ifTrue:ifFalse:`,
`ifFalse:ifTrue:`, `and:`, and `or:`.  Conditional methods invoke only the
selected block.  Blocks accept zero through four arguments through `value`
and repeated `value:` selectors.  `whileTrue:` and `whileFalse:` execute
without recursive loop frames and return `nil`.

Most control methods are compiled Smallslop source.  `whileTrue:` uses a
bytecode loop.  Numeric primitives perform the corresponding host operation.
The library's initial `=` delegates to `==`, which uses JavaScript strict
equality.  User classes can replace `=`.

## Debugger API

| Operation | Behavior |
| --- | --- |
| `start(receiver, selector, args)` | Create a paused process for a message send |
| `run(id, {budget})` | Execute at most `budget` bytecodes, default 10,000 |
| `resume(id, {budget})` | Continue the pending stepping operation across budgets or breakpoints |
| `inspect(id)` | Read status, frames, source positions, bindings, and operand stacks |
| `step(id)` | Execute one instruction, entering calls |
| `stepOver(id, {budget})` | Execute one instruction and its calls, subject to breakpoints and budget |
| `stepOut(id, {budget})` | Run until the current frame returns, subject to breakpoints and budget |
| `breakpoint(method, pc, code)` | Stop before an instruction in a method or its block code |
| `clearBreakpoint(breakpointId)` | Remove a breakpoint |
| `setVariable(id, frameId, name, value, {depth})` | Change a paused frame's binding in a selected lexical scope, or the nearest binding when depth is omitted |
| `setSendOperand(id, frameId, index, value)` | Edit the current pending send: index 0 is its receiver, followed by arguments |
| `retry(id, {budget})` | Retry a failed instruction and continue |
| `cancel(id)` | Cancel a paused or waiting process and invalidate its active method returns |
| `pause(id)` | Stop further scheduled batches while preserving the stepping target |
| `dispose(id)` | Remove a completed or cancelled process record |

Inspection includes each frame's `codePath` and current `pendingSend`.
`stepOver` and `stepOut` preserve their original target across budgets.
`resume` continues that operation.  `run` replaces it with ordinary execution.
Changing a lexical binding preserves values already evaluated on the operand
stack.  `setSendOperand` edits those pending values explicitly.

Interpreter failures pause execution with an `Error` in `state.stop.error`.
A failed send retains its receiver and arguments on the operand stack.
Installing a missing method and calling `retry` repeats that send.  Earlier
instructions retain their effects.  A primitive can perform an effect before
throwing, so retrying a primitive can repeat that effect.

Runtime inspection returns JavaScript values and runtime object references.
Execution yields between instructions.  A synchronous primitive runs to
completion before the runtime can suspend it.

Source-level stepping, invocation restart, and snapshots remain on the
development agenda.

## Host interface and scheduling

`new Host(runtime, runner)` installs property access, method calls, function
calls, and event registration on `HostObject`.  `host.value` wraps foreign
objects while preserving their identity, and `host.unwrap` retrieves the
native value.  Numbers remain Floats, and undefined has a distinct wrapper.
The messages are `get:`, `set:to:`, `call:`, `call:with:` with up to four
arguments, `invoke`, `invokeWith:` with up to four arguments, and `on:do:`.

Promise-returning calls enter the `waiting` state.  `whenReady(id)` resolves
after completion, rejection, or cancellation.  Rejection preserves the failed
send for repair and retry.  A `HostOperation` can provide a cancellation
handler.  Late completion of a cancelled wait has no effect on its process.

`ProcessRunner` executes bounded batches through timer tasks and stops at
debugger suspension points.  `follow(id)` updates scheduling after a command.
`host.scope()` owns event listeners and processes.  Its `start` schedules a
call, `reap` disposes terminal processes, and `dispose` removes listeners and
cancels and disposes owned processes.  The [embedding instructions](docs/manual.md#host-values-and-calls)
describe the API, value conversion, and callback limits.

## Agent access

`new Debugger(runtime)` provides a JSON-safe adapter.  `dispatch(request)`
accepts an operation name and arguments.  It returns encoded values,
frame and method IDs, object handles, and structured suspended errors.
Invalid requests throw.  Integer values use decimal strings.  Float values
preserve negative zero, infinity, and NaN through tagged encodings.

```js
import { Debugger } from './src/index.js';

const debugger_ = new Debugger(runtime);
const state = debugger_.dispatch({ op: 'evaluate', source: '| value | value' });
debugger_.dispatch({
  op: 'setVariable', processId: state.id, frameId: state.frames[0].id,
  name: 'value', value: { kind: 'integer', value: '9007199254740993' },
});
const result = debugger_.dispatch({ op: 'run', processId: state.id });
```

Control operations are `run`, `resume`, `step`, `stepOver`, `stepOut`, `retry`, and
`cancel`, with `processId` and optional `budget`.  `evaluate` accepts `source`
and optional `processId`, `frameId`, or encoded `receiver`.  `install` accepts
`className`, method `source`, and optional `protocol`, `expectedMethodId`, and
`selector`.  `classes` lists class metadata.  `methods` lists current methods
with optional `className`, `selector`, or `sends` filters.  `processes` lists
process IDs and status.

`object` accepts a handle `id` and reports slots, class methods, block scopes,
or array contents.  Array inspection accepts `offset` and `limit`.
`method` accepts a method `id` and reports source, instructions, and block
paths.  `breakpoint` accepts `methodId`, instruction `pc`, and optional block
`path`.  `clearBreakpoint` accepts the breakpoint `id`.

An adapter retains each object handle until `release` receives its `ids`.
Handles preserve cycles and shared identity.  Releasing a handle does not
remove the corresponding runtime object.  This adapter supplies local agent
operations.  `retainMethod` and `releaseMethods` control retained method
history.  `releaseAll` clears all handles and retained methods in the adapter.
`dispose` removes a completed or cancelled process.  `server/server.mjs`
and `ui/agent-connection.js` carry these operations between a page and its
agent.
