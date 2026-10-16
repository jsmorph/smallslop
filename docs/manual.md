# Smallslop manual

Smallslop is a Smalltalk-like language implemented as a JavaScript-hosted
bytecode interpreter.  The same ES modules run in Node and a browser.
Classes, method versions, lexical environments, and call frames belong to the
runtime.  Its debugger exposes inspection, stepping, variable changes, source
evaluation, method installation, and retry through JavaScript and JSON APIs.

This manual describes the interpreter in `src/`, the browser tools in `ui/`,
the Node runtime, Web server, and Pi agent in `server/`, and the examples.
`components/` holds a runtime for versioned JavaScript components, and
`server/component-store.mjs` stores their versions.  Each directory imports
only the directories it depends on, so a project can copy the directories it
needs.

## Running Smallslop

### Requirements and commands

The examples and tests run on Node 24, which provides `node:sqlite`.  The
interpreter and browser tools use no packages.  `server/agent.mjs` and the
workspace example use `@earendil-works/pi-coding-agent`, which `npm install`
installs.  The commands run from the repository root:

| Command | Result |
| --- | --- |
| `npm test` | Run the Node tests |
| `npm run demo` | Run the nested-block debugger and missing-method repair example |
| `npm run serve` | Serve the interactive counter page and scripted repair example on a local port |
| `npm run test:browser` | Test page controls, serialized debugger commands, host operations, disposal, and scripted repair in Chromium |
| `npm run workspace` | Serve the workspace example with a Pi agent on a local port |
| `npm run test:workspace` | Test the workspace page, Web server, agent tools, and server database in Chromium with a test agent |

The browser tests use `chromium` on `PATH`.  The `CHROMIUM` environment
variable can name another Chromium executable.  The example servers print a
URL such as `http://127.0.0.1:PORT/` and run until interrupted.  The counter
server loads the source files at startup, so source edits require a server
restart.  A browser on the same machine can open the printed address.

### Evaluating an expression in Node

This command prints `42n`, Node's display of an exact integer:

```sh
node --input-type=module <<'JS'
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const processId = runtime.evaluate('6 * 7');
const state = runtime.run(processId);
if (state.stop.reason === 'error') throw state.stop.error;
if (state.status !== 'completed') throw new Error(state.stop.reason);
console.log(state.result);
JS
```

`evaluate` compiles the source and creates a paused process.  `run` executes
it and returns a state record.  The completed process's `result` is a
JavaScript value.  The default receiver for an evaluated expression is `nil`.

The JavaScript examples below are independent Node ES modules, except the
browser-console example.  Each can be saved in a `.mjs` file at the repository
root and run with `node`, or passed to `node --input-type=module` on standard
input.  Smallslop examples marked `smalltalk` are source strings for
`evaluate`, unless described as method definitions.

### Using the browser

The root URL of `npm run serve` opens two counters and a shared debugger and
method editor.  Each counter is a Smallslop object with its own DOM root and
host scope.
Smallslop methods register its callbacks, update its count, render its output,
and invoke delayed host work.  The [counter source](../examples/counters.js)
contains those methods and the JavaScript debugger interface.

| Control | Behavior |
| --- | --- |
| Increment | Invoke a block that captures the increment amount |
| Pause next event | Pause that counter's next queued callback before its entry send |
| Missing method | Increment the stored count, then send the initially missing `missingText` message |
| Count 10,000 | Run a loop in bounded batches and render when it finishes |
| Increment later | Wait for a host result, then increment |
| Reject later | Wait for a host rejection and pause at the failed call |
| Inspect process | Select that counter's latest process |
| Remove | Remove the counter's listeners and cancel and dispose its processes |

The debugger lists processes and frames, highlights the current source span,
and shows lexical bindings and prepared send operands.  Edits use the JSON
value format described under [agent access](#json-debugger-api-for-agents).
Run starts ordinary execution.  Resume preserves a pending step-over or
step-out target.  Break here uses the selected frame's code path and PC.
Break at entry uses the method version loaded in the editor.  A method
breakpoint applies to every invocation of that version.

A captured-binding exercise uses these controls:

1. Select Pause next event on the first counter, then Increment.
2. Step into the callback.  For Increment, three bytecode steps enter its block.
3. Set the `step` binding in scope 1 to `{"kind":"integer","value":"7"}`.
4. Increment the other counter while the first remains paused.
5. Resume the first process.  Its count increases by seven.  Later callbacks share the changed binding.

New method loads `missingText ^count asString`.  After Missing method pauses,
Install method followed by Retry completes the rendering send.  The stored
count increases once.  Method edits preserve the version held by an active
frame, while later sends use the replacement.

Reject later pauses with a prepared `call:with:with:` send.  Setting Argument 3
to `{"kind":"boolean","value":false}` and selecting Retry starts a successful
host call.  Cancel during a wait cancels the timer and prevents resumption.
Cancellation preserves state changes made before the cancelled operation.
The counting loop updates its stored count during execution and renders at
completion.  Inspecting its Counter receiver reveals the stored count while
it is paused.

The page retains the selected or latest terminal process for each counter
and disposes older terminal records.  Frame evaluations inherit the counter's
scope.  Removing a counter disposes all its processes.  The method editor
retains its loaded version until another method is loaded.

The page exposes `smallslop.dispatch(request)` for serialized debugger
commands.  Its JSON command panel uses that function.  Page controls use the
same debugger operations through a separate adapter, so refreshing the UI
preserves agent handles.  An agent releases its handles and retained methods
with `release`, `releaseMethods`, or `releaseAll`.  A standalone evaluation
created without a frame has no counter owner and requires explicit disposal.

The console also exposes `Runtime`, `Debugger`, and the page's `runtime`,
`runner`, and `host`.

```js
const runtime = new smallslop.Runtime();
const state = runtime.run(runtime.evaluate('2 asFloat + 0.5'));
console.log(state.status, state.result);
```

The output is `completed 2.5`.  The linked [scripted repair
page](../examples/repair.html) preserves the earlier demonstrations and
their `createRepairDemo`, `runRepairDemo`, and `runAgentRepairDemo` console
helpers.  It uses the same [repair code](../examples/repair.js) as Node.

### Workspace and agent

`npm run workspace` starts the [workspace example](../examples/workspace/page.js)
and prints its local URL.  The page contains movable, resizable panes: an
agent conversation, the System Browser, the Debugger, object inspectors, a
pane list, and an activity log.  Pane geometry and visibility belong to
Smallslop objects, and the user and the agent operate the same objects and
debugger.  Each request captures the focused pane, so a later focus change
leaves the request's target intact.  `--host ADDRESS` selects the listening
address, with `127.0.0.1` as the default, and `--port PORT` selects the port.
`--database FILE` gives every page the same SQLite file in place of a
separate in-memory database.

The agent requires a Pi model credential, such as a login stored in Pi's
`auth.json` or `OPENAI_API_KEY`.  `server/model-runtime.mjs` restricts the
choice to providers stored in `auth.json` when any exist.  It then selects
the first available model from its preference list, or the first available
model.

`server/server.mjs` serves files from listed directories and accepts one
WebSocket at `/api/session` for each page.  A server listening on a loopback
address accepts only the `127.0.0.1`, `localhost`, and `[::1]` host names,
which blocks DNS rebinding.  A server listening on another address accepts
any host name and has no authentication, so anyone who can reach it can use
the agent and the database.  Every server rejects WebSockets whose origin
differs from the requested host.  Each
connection owns a server Smallslop runtime, a database connection, and an
agent created on the first prompt.  `ui/agent-connection.js` is the page side
of that connection.

| Direction | Message | Meaning |
| --- | --- | --- |
| Page to server | `{type:'prompt', id, message, context}` | Start an agent turn.  The reply arrives when the turn ends. |
| Page to server | `{type:'interrupt'}` | Stop the current turn |
| Page to server | `{type:'reset', id}` | Discard the conversation |
| Page to server | `{type:'server', id, command}` | Execute a server runtime command |
| Page to server | `{type:'commandResult', id, result}` or `error` | Answer a page command |
| Server to page | `{type:'session', state}` | Report status, model, and messages |
| Server to page | `{type:'command', id, command}` | Execute a page command for the agent |
| Server to page | `{type:'reply', id, result}` or `error` | Answer a request |

`server/agent.mjs` provides `createPiAgent` and `smallslopTools`.  The three
tools read page state, execute page commands, and execute server commands.
An application supplies the agent's instructions and can add its own tools.
The [workspace server](../examples/workspace.mjs) passes
`createSmallslopServer` a function that creates the agent, and the browser
test passes a test agent instead.

The System Browser selects a category, class, protocol, and method above a
source editor.  It supports live method installation, draft and version
checks, sender and implementor searches, class hierarchy and slot
inspection, and entry breakpoints.  The Class button shows shared `Class`
behavior.  `ui/development.js` adds the System Browser, Debugger, and object
inspector panes to a workspace created by `ui/workspace.js`.  Its `server`
option gives the Debugger a Server selector.

### Object inspectors

Inspect database in the toolbar opens the server Database object.  The
`inspect` page command opens a named pane, the focused pane, or an encoded
value.  Each inspector lists fields, displays a selected value, and
evaluates source with its original receiver as `self`.  Inspect field and
Inspect result open independent inspectors.  Debug it starts a paused
evaluation, and Debugger opens that process for inspection and repair.

An `Inspector` object owns its receiver, selection, offset, expression, and
evaluation.  Each session owns its debugger handles and processes.  An
attached debugger retains its evaluation after the inspector closes.
Host records and arrays expose stored values and label accessors.  Collection
inspection reads pages of 100 values and preserves ResultSet position.

For embedding, `new Inspectors(host, debuggerAdapter)` installs the Inspector
class and owns inspection sessions.  `open(value)` returns a session with
`id`, `object`, and `state()`.  `dispatch({action:'open', value:encodedValue})`
decodes through the supplied debugger adapter and returns session state.
Subsequent actions use that session ID.  `retain` accepts an optional
`processId`, and matching `close` calls release those references.  `dispose()`
releases all sessions.  The registry uses its host's runtime and runner.

### Server runtime and database

`ServerWorld` in `server/world.mjs` is a server Smallslop runtime with a
`Database` object.  `Database execute:parameters:` accepts SQL reads, writes,
schema changes, and explicit transactions.  It returns a `ResultSet` with
column metadata, completed rows, affected-row count, paging, and closure.
Results stay in server memory until closed.  SQL runs in a separate process
so the server debugger can respond during execution.

`ServerWorld.dispatch` accepts the commands `state`, `schema`, `execute`,
`next`, `page`, `close`, `completion`, `send`, `inspector`, and `debug`.  The
agent's `smallslop_server` tool and the page's server requests use the same
commands.  A failed SQL send pauses with its frames retained for repair and
retry.  SQL parameters accept JSON strings, numbers, and null, or Smallslop
encodings such as `{kind:"integer",value:"123"}` and
`{kind:"bytes",value:[0,255]}`.

## Source language

### Values and numeric types

| Smallslop source | Class | JavaScript representation |
| --- | --- | --- |
| `42`, `-7`, `9007199254740993` | `Integer` | `BigInt` |
| `42.0`, `-0.25`, `2e3` | `Float` | `Number` |
| `'text'`, `'it''s a string'` | `String` | String |
| `true`, `false` | `True`, `False` | Boolean |
| `nil` | `UndefinedObject` | `null` |
| `[42]` | `Block` | A block with its captured environment |
| `Object` | `Class` | The class object registered under that name |

Double quotes delimit comments.  Names use ASCII letters, digits, and
underscores, with a letter or underscore first.  Local and slot names resolve
before registered class names.  `self`, `super`, `nil`, `true`, and `false`
have reserved meanings.

Integer arithmetic preserves exact results.  Arithmetic and ordering require
operands of the same numeric class.  `asFloat` converts an Integer to a Float
and can lose precision.  JavaScript callers pass `42n` for an Integer and
`42` for a Float.

| Expression | Result |
| --- | --- |
| `9007199254740993 + 2` | Integer `9007199254740995` |
| `2 asFloat + 0.5` | Float `2.5` |
| `1 + 1.0` | A suspended type error |
| `7 quo: 3` | Integer `2` |
| `-7 quo: 3` | Integer `-2` |
| `-7 rem: 3` | Integer `-1` |
| `7.5 / 2.5` | Float `3.0` |
| `-2.75 truncated` | Integer `-2` |

`quo:` truncates division toward zero.  `rem:` computes the remainder using
that quotient.  Both suspend with an error for a zero divisor.  Float `/`
follows JavaScript Number division, including infinity and NaN.  `truncated`
returns the float's integer part as an Integer and rejects infinity and NaN.

### Messages and methods

A message has a receiver, a selector, and zero or more arguments.  The selector
identifies the method to look up.

| Message form | Example | Selector |
| --- | --- | --- |
| Unary | `7 negated` | `negated` |
| Binary | `3 + 4` | `+` |
| Keyword | `true ifTrue: [1] ifFalse: [2]` | `ifTrue:ifFalse:` |

Unary messages bind before binary messages.  Binary messages bind before
keyword messages and associate from left to right.  Parentheses group
expressions.  Thus `1 + 2 * 3` evaluates to `9`, while `1 + (2 * 3)` evaluates
to `7`.

A method starts with its selector and argument names, followed by optional
locals and its statements.  These are separate method definitions:

```smalltalk
answer
  ^42
```

```smalltalk
+ other
  ^self combine: other
```

```smalltalk
add: first to: second
  | sum |
  sum := first + second.
  ^sum
```

Periods separate statements.  A final period is allowed.  A method returns
its receiver unless it executes `^expression`.  The compiler rejects a
statement after a return in the same statement sequence.  A method can send
other messages through `self`.  A `super` send starts lookup at the superclass
of the class that defined the current method, while keeping the receiver.

### Bindings and blocks

`| first second |` declares locals at the start of a method, evaluated
expression, or block body.  Locals begin as `nil`.  `:=` assigns a local,
argument, captured binding, or receiver slot, and yields the assigned value.
Assignments associate from right to left.

A block captures its lexical environment.  Captured variables remain shared
bindings, so this expression returns Integer `2`:

```smalltalk
| value change |
value := 1.
change := [value := 2].
change value.
value
```

Block arguments begin with `:` and end at `|`.  Block locals can follow in
another pair of bars.  This expression returns Integer `10`:

```smalltalk
[:x | | doubled | doubled := x * 2. doubled] value: 5
```

A block returns its final expression.  An empty block returns `nil`.  Block
arguments and locals can shadow outer bindings.  Captured bindings remain
available after the enclosing method returns.

`^` inside a block returns from the enclosing method activation.  In an
evaluated expression, that activation belongs to the expression's process.
For example, `[true ifTrue: [^7]] value. 99` returns Integer `7`.  A block
attempting that return after its home activation has ended, or from a
different process, suspends with an error.

### Control flow and library methods

Conditions and loops use message sends.  A Boolean conditional invokes the
selected block and returns its result.  A one-branch conditional returns
`nil` when its branch is skipped.  `and:` and `or:` evaluate their argument
block only when its result is needed.

This expression returns Integer `120`:

```smalltalk
| i result |
i := 1.
result := 1.
[i <= 5] whileTrue: [
  result := result * i.
  i := i + 1
].
result
```

`whileTrue:` and `whileFalse:` expect a zero-argument condition block and a
zero-argument body block.  Their result is `nil`.  The loop reuses its loop
frame and yields when its process exhausts the instruction budget.

| Receiver | Initial methods |
| --- | --- |
| Every object | `yourself`, `class`, `==`, `=`, `~=`, `isNil`, `notNil` |
| Ordinary class | `new` |
| Integer and Float | `+`, `-`, `*`, `<`, `<=`, `>`, `>=`, `negated`, `asFloat`, `asString` |
| Integer | `quo:`, `rem:` |
| Float | `/`, `truncated` |
| Boolean | `not`, `ifTrue:`, `ifFalse:`, `ifTrue:ifFalse:`, `ifFalse:ifTrue:`, `and:`, `or:` |
| Block | `value`, `value:`, `value:value:`, `value:value:value:`, `value:value:value:value:`, `whileTrue:`, `whileFalse:` |

The initial `=` sends `==`, which uses JavaScript strict equality.  Distinct
ordinary objects compare by identity.  Primitive values compare by their
JavaScript value and type, so `1 = 1.0` is false.  User classes can replace `=`.

## Classes and method installation

`defineClass` creates an ordinary class.  Its default superclass is `Object`.
Its optional `category` names the browser group and defaults to `Unclassified`.
Slots include inherited slots and begin as `nil`.  Slot names must be distinct
across the inheritance chain.  `newObject` allocates an instance.  The source
message `Counter new` performs the same allocation.

```js
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const counterClass = runtime.defineClass('Counter', { slots: ['count'] });
runtime.installSource(counterClass, 'initialize count := 0');
runtime.installSource(counterClass, 'increment count := count + 1. ^count');
runtime.installSource(counterClass, 'count ^count');

const counter = runtime.newObject(counterClass);
runtime.run(runtime.start(counter, 'initialize'));
console.log(runtime.run(runtime.start(counter, 'increment')).result);
console.log(runtime.run(runtime.start(counter, 'count')).result);
```

The output is `1n` on each line.  Allocation initializes slots to `nil`.
The example sends `initialize` as a separate operation.

Inheritance and `super` sends work with source methods:

```js
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const base = runtime.defineClass('Base');
const child = runtime.defineClass('Child', { superclass: base });
runtime.installSource(base, 'answer ^40');
runtime.installSource(child, 'answer ^super answer + 2');
console.log(runtime.run(runtime.evaluate('Child new answer')).result);
```

The result is `42n`.  `installSource` returns a method object with an ID,
owner, selector, arity, and compiled `code`.  `lookup(klass, selector)` searches
the class and its ancestors and returns a method or `null`.

`installSource`, `install`, and `primitive` accept an optional final options
object with a `protocol` name.  Replacement preserves the current protocol
when that option is omitted.  A new selector defaults to `unclassified`.
Method descriptions distinguish `source`, `bytecode`, and `primitive` forms.

`installSource` also accepts `expectedMethodId` and `selector`.  The expected
ID must match the installed version.  `null` requires an unused selector.
The optional selector requires the source to retain that selector.  Failed
validation leaves the installed method unchanged.

Installing the same selector creates a new immutable method version.  New
sends find that version.  An invocation already in progress keeps its previous
version, source, and instruction positions.  Breakpoints belong to a method
version and remain attached to that version after replacement.
`runtime.methods` indexes versions through weak references.  A class's method
dictionary, active frame, escaped block, breakpoint, or explicit debugger
reference keeps a version alive.  Unreferenced versions can be collected.

## Processes and the debugger

### Process state and execution

`start(receiver, selector, args = [])`, `evaluate(source, options = {})`, and
`startCode(receiver, code)` create paused processes and return process IDs.
`start` prepares a message send.  `evaluate` compiles an expression sequence
whose final value becomes the process result.  `startCode` accepts compiled
code with no arguments.

`inspect(id)` returns `{id, status, stop, result, action, frames}`.  Each call to `run`
or a stepping operation returns the same record shape.  `result` holds the
return value when `status` is `completed`.

| Status | Meaning |
| --- | --- |
| `paused` | Execution can be inspected and controlled |
| `running` | The interpreter is executing within a synchronous call |
| `waiting` | A host call is pending.  Its send and operands remain inspectable |
| `completed` | The entry invocation returned a result |
| `cancelled` | Cancellation discarded the call chain and invalidated its active method returns |

| `stop.reason` | Meaning |
| --- | --- |
| `start` | The process was created |
| `breakpoint` | Execution reached the instruction identified by `breakpointId` |
| `step` | A stepping operation reached its stopping point |
| `budget` | Execution used the allowed number of bytecodes |
| `pause` | An explicit pause stopped further scheduled execution |
| `await` | A host call is waiting for completion |
| `ready` | A host call completed, and execution can resume |
| `error` | An instruction failed.  `stop.error` holds the failure |
| `return` | The process completed |
| `cancelled` | The process was cancelled |

`run(id, {budget: 10000})` executes up to 10,000 bytecodes by default.
The budget must be a positive safe integer.  A host can schedule processes in
successive runs and yield between them:

```js
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const processId = runtime.evaluate(`
  | i total |
  i := 1. total := 0.
  [i <= 100] whileTrue: [total := total + i. i := i + 1].
  total
`);
let state;
do {
  state = runtime.run(processId, { budget: 100 });
  if (state.status === 'paused' && state.stop.reason === 'budget') {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
} while (state.status === 'paused' && state.stop.reason === 'budget');
if (state.stop.reason === 'error') throw state.stop.error;
console.log(state.status, state.result);
```

The output is `completed 5050n`.  Instruction budgets count bytecodes.
A synchronous primitive finishes before the interpreter checks the next
instruction.  Pausing one process leaves other processes available to the
host.  The runtime retains process records in `runtime.processes` until
`dispose(id)` removes a completed or cancelled process.  A paused process
must be cancelled before disposal.  Disposal releases the runtime's reference
to that record.  A result retained by application code remains usable.

### Frames, inspection, and stepping

`frames[0]` is the current frame.  Later entries are its callers.  A synthetic
`<entry>` frame represents a host-initiated message or evaluated expression.

| Frame field | Meaning |
| --- | --- |
| `id`, `methodId` | Frame ID and method version ID |
| `codePath` | Literal indexes identifying this frame's code within the method, with `[]` for the method body |
| `selector`, `className` | Selector and defining class |
| `receiver` | Receiver object or primitive value |
| `pc`, `instruction` | Next bytecode's byte offset and decoded instruction |
| `source`, `position` | Source string and optional `{pc, start, end}` span |
| `scopes` | Binding records, from the current lexical scope outward |
| `stack` | A copy of the operand stack |
| `pendingSend` | Current prepared send, with selector, receiver, arguments, and a `super` flag, or `null` |

Source spans use JavaScript string offsets, with an exclusive `end`.
`frame.source.slice(frame.position.start, frame.position.end)` extracts the
source for a mapped instruction.  Hand-assembled code can have a `null`
position.  Runtime inspection copies scope records and operand arrays while
preserving the identity of their object values.

| Runtime operation | Behavior |
| --- | --- |
| `step(id)` | Execute one bytecode, entering a called method or block |
| `stepOver(id, {budget})` | Execute the current bytecode and the calls it starts, subject to breakpoints and budget |
| `stepOut(id, {budget})` | Execute until the current frame returns, subject to breakpoints and budget |
| `resume(id, {budget})` | Continue the pending operation with its original target |
| `breakpoint(method, pc = 0, code = method.code)` | Stop before an instruction in the method or one of its nested blocks.  Return the breakpoint ID |
| `clearBreakpoint(breakpointId)` | Remove a breakpoint |
| `setVariable(id, frameId, name, value, {depth})` | Change a binding in a selected lexical scope.  Omit depth to select the nearest binding with that name |
| `setSendOperand(id, frameId, index, value)` | Edit a prepared send in the current frame.  Index 0 selects the receiver, and 1 selects the first argument |
| `retry(id, {budget})` | Retry a failed instruction and continue |
| `cancel(id)` | Cancel a paused or waiting process |
| `pause(id)` | Pause between execution batches while preserving the stepping target |
| `dispose(id)` | Remove a completed or cancelled process record |

Stepping operates on bytecodes.  A source expression can require several
steps.  Continuing from a breakpoint executes the paused instruction before
the same breakpoint can stop the process again.  `setVariable` affects the
binding shared by any blocks that capture it.  Slot changes can be expressed
through source evaluation with the frame's receiver.

`action` records a pending stepping operation as `{kind, frameId}`.
`stepOver` and `stepOut` preserve that target across instruction budgets.
Repeating the same operation after a budget stop, or calling `resume`,
continues toward the target.  `resume` also preserves the target after a
breakpoint.  `run` clears the stepping request and continues execution.

A lexical edit affects later reads of that binding.  Previously evaluated
values remain on the operand stack.  For example, changing a divisor after
division fails leaves the pending argument unchanged.  `setSendOperand`
can replace that argument before retry without repeating prior expressions.
The receiver of a super send remains the frame's receiver.  `retry` executes
the failed instruction before checking its breakpoint again.

### Editing a paused frame

This example pauses on method entry, changes an argument, and resumes:

```js
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const klass = runtime.defineClass('Example');
const method = runtime.installSource(klass, 'twice: value ^value * 2');
const breakpointId = runtime.breakpoint(method);
const processId = runtime.start(runtime.newObject(klass), 'twice:', [3n]);
const paused = runtime.run(processId);
console.log(paused.stop.reason, paused.frames[0].scopes[0].value);
runtime.setVariable(processId, paused.frames[0].id, 'value', 21n);
console.log(runtime.run(processId).result);
runtime.clearBreakpoint(breakpointId);
```

The output is `breakpoint 3n`, followed by `42n`.

`evaluate(source, {processId, frameId})` creates a separate process that shares
the paused frame's receiver and lexical bindings.  Omitting `frameId` selects
the current frame.  Running the evaluation leaves the original process paused.
The evaluation has its own return activation.  Its local declarations can
shadow the paused frame's bindings.

### Repairing a failed send

Syntax and name-resolution errors throw `SyntaxError` with `position`, `line`,
and `column`.  The position is a zero-based JavaScript string offset.  Line and
column numbers start at one.  Invalid debugger operations throw to their
JavaScript caller.  Execution errors suspend the process with
`stop.reason === 'error'`.

A missing method produces `MessageNotUnderstood` with `receiver`, `selector`,
and `arguments`.  The failed send preserves its instruction position and
operands.  The debugger can install a method and retry from that position:

```js
import { createRepairDemo } from './examples/repair.js';

const { runtime, klass, processId } = createRepairDemo();
const paused = runtime.run(processId);
const frameId = paused.frames[0].id;
const evaluationId = runtime.evaluate('captured := 42', { processId, frameId });
console.log(runtime.run(evaluationId).result);

const failed = runtime.run(processId);
console.log(failed.stop.error.name, failed.stop.error.selector);
console.log(failed.stop.error.arguments[0]);
runtime.installSource(klass, 'finish: value ^value');
const completed = runtime.retry(processId);
console.log(completed.status, completed.result);
```

The output is:

```text
42n
MessageNotUnderstood finish:
42n
completed 42n
```

The example starts in a nested block and edits a captured binding through a
separate evaluation.  Repair retries the failed send.  Earlier instructions
retain their effects.  An error-paused process continues through `retry`.
`cancel` discards its call chain.  A primitive that performs an effect before
throwing can repeat that effect when retried.

## JSON debugger API for agents

### Commands and values

`new Debugger(runtime)` provides `dispatch(request)`.  Requests name an `op`
and its arguments.  Responses contain JSON-safe values, frame and method IDs,
object handles, and structured errors for suspended processes.  Invalid
requests throw to the adapter's caller.

```js
import { Debugger, Runtime } from './src/index.js';

const debugger_ = new Debugger(new Runtime());
const send = request => JSON.parse(JSON.stringify(
  debugger_.dispatch(JSON.parse(JSON.stringify(request))),
));
const paused = send({ op: 'evaluate', source: '| value | value' });
send({
  op: 'setVariable', processId: paused.id, frameId: paused.frames[0].id,
  name: 'value', value: { kind: 'integer', value: '9007199254740993' },
});
const completed = send({ op: 'run', processId: paused.id });
console.log(completed.status);
console.log(JSON.stringify(completed.result));
```

The output is:

```text
completed
{"kind":"integer","value":"9007199254740993"}
```

An adapter's `value(value)` method encodes a supported runtime value.
Its `decode(record)` method restores that value within the adapter.

| Value | Encoding |
| --- | --- |
| `nil` | `{"kind":"nil"}` |
| Integer | `{"kind":"integer","value":"42"}` |
| Finite Float | `{"kind":"float","value":2.5}` |
| Special Float | `{"kind":"float","value":"-0"}`, with `"NaN"`, `"Infinity"`, or `"-Infinity"` as the other special values |
| Boolean | `{"kind":"boolean","value":true}` |
| String | `{"kind":"string","value":"text"}` |
| Object reference | `{"kind":"object","id":1,"className":"Counter"}`, with an ID allocated by the adapter |

Process, frame, method, and breakpoint IDs belong to the runtime.  Object
handle IDs belong to a debugger adapter.  Their numeric values can overlap.

| `op` | Request fields beyond `op` | Response |
| --- | --- | --- |
| `processes` | None | Array of `{id, status}` records |
| `classes` | None | Class names, categories, superclasses, slots, and method counts |
| `methods` | Optional `className`, `selector`, `sends` | Current methods with owner, selector, protocol, implementation form, ID, and available source.  `sends` finds bytecode sends, including nested blocks. |
| `inspect` | `processId` | Encoded process state |
| `run`, `resume`, `stepOver`, `stepOut`, `retry` | `processId`, optional `budget` | Encoded process state |
| `step`, `pause`, `cancel` | `processId` | Encoded process state |
| `evaluate` | `source`, optional `processId`, `frameId`, or encoded `receiver` | New paused process state |
| `setVariable` | `processId`, `frameId`, `name`, encoded `value`, optional lexical `depth` | Updated process state |
| `setSendOperand` | `processId`, `frameId`, operand `index`, encoded `value` | Updated process state |
| `dispose` | `processId` | `{id, status: 'disposed'}` |
| `install` | `className`, method `source`, optional `protocol`, `expectedMethodId`, `selector` | Installed method description |
| `method` | Method `id` | Selector, owner class name, protocol, implementation form, arity, primitive flag, and compiled code records |
| `breakpoint` | `methodId`, optional `pc` and block `path` | `{id}` |
| `clearBreakpoint` | Breakpoint `id` | `{cleared: id}` |
| `object` | Object handle `id`, optional array `offset` and `limit` | Object description |
| `release` | Object handle `ids` | `{released: ids}` |
| `retainMethod` | Method `id` | `{retained: id}` |
| `releaseMethods` | Retained method `ids` | `{released: ids}` |
| `releaseAll` | None | `{released: 'all'}` |

An evaluated source string can create an ordinary object and send a message,
for example `Counter new initialize` when `Counter` is registered.  Class
creation uses the runtime's JavaScript API.  A caller attaching this adapter
to an agent supplies the transport and reports thrown request errors to that
agent.

### Object handles and block breakpoints

Object handles preserve cycles and shared identity.  `object` reports an
instance's slots, a class's own methods and superclass, a block's captures and
home activation, or an array's items.  Array inspection defaults to offset
zero and a limit of 100.  The maximum limit is 1,000.

Host object inspection reports own string-named properties with encoded
values or accessor descriptions.  It reads property descriptors without
invoking getters.  Host arrays and typed arrays report indexed pages, including
absent elements.  JavaScript proxies can execute their reflection traps.
`debugger.describe(value, options)` also accepts primitive runtime values.

The adapter retains an object until `release` receives its handle ID.
Releasing a handle invalidates that ID.  Other runtime references can retain
the object, and encoding it again creates a new handle.

`retainMethod` keeps a method version available after its other references
disappear.  `releaseMethods` releases those references.  `releaseAll` clears
the adapter's object handles and retained methods.  A numeric method ID alone
does not retain its method.  Collection timing belongs to the host runtime.

A method description's `codes` array contains one record for the method and
each nested block.  Its `path` lists the literal indexes leading from the
method code to that block.  The method's own path is `[]`.  A block literal
appears as `{kind: 'code', path}`.  A breakpoint uses this path and a bytecode
offset:

```js
import { Debugger, Runtime } from './src/index.js';

const debugger_ = new Debugger(new Runtime());
const entry = debugger_.dispatch({ op: 'evaluate', source: '[42] value' });
const methodId = entry.frames[0].methodId;
const method = debugger_.dispatch({ op: 'method', id: methodId });
const block = method.codes.find(code => code.path.length === 1);
debugger_.dispatch({ op: 'breakpoint', methodId, path: block.path, pc: 0 });
const paused = debugger_.dispatch({ op: 'run', processId: entry.id });
const frame = paused.frames[0];
console.log(paused.stop.reason);
console.log(frame.source.slice(frame.position.start, frame.position.end));
```

The output is `breakpoint`, followed by `42`.

## Embedding and bytecode

### Synchronous JavaScript primitives

`primitive(klass, selector, arity, invoke)` installs a method backed by a
JavaScript function.  The function receives the receiver, an argument array,
and `{processId, scope}`.  Its return value must have a Smallslop class or be
a `HostOperation`.  Supported values include
ordinary Smallslop objects, classes, blocks, `null`, Booleans, strings, BigInts,
Numbers, and JavaScript arrays.  `classOf(value)` returns their runtime class.

```js
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const serviceClass = runtime.defineClass('HostService');
runtime.primitive(serviceClass, 'square:', 1, (_receiver, [value]) => {
  if (typeof value !== 'bigint') throw new TypeError('square: expects an Integer.');
  return value * value;
});
const service = runtime.newObject(serviceClass);
console.log(runtime.run(runtime.start(service, 'square:', [12n])).result);
```

The result is `144n`.  Primitive exceptions suspend at the send and preserve
its operands.  A synchronous primitive runs to completion or failure within
one instruction.  Returning a `HostOperation` suspends the process.

### Host values and calls

`new Host(runtime, runner)` installs the host methods once per runtime.
`host.value(value)` preserves strings, Booleans, BigInts, Numbers, and `null`.
It wraps foreign objects, arrays, and functions in `HostObject` values while
preserving their host identity.  `host.unwrap(value)` recovers the original
value.  Host Numbers remain Floats.  Integer conversion uses `asFloat` when
the called API requires a Number.

JavaScript `undefined` has a distinct host wrapper whose `isUndefined`
returns `true`.  Property names use strings.  Host symbols remain unsupported.
Smallslop objects, classes, and blocks passed to `host.value` retain their
runtime identity.

| HostObject message | Behavior |
| --- | --- |
| `get: name` | Read a property |
| `set: name to: value` | Set a property and return the assigned value |
| `call: name` | Invoke a method with its host receiver |
| `call: name with: argument` | Invoke a method with one argument.  Repeated `with:` parts support up to four arguments |
| `invoke`, `invokeWith: argument` | Invoke a host function.  Repeated `with:` parts support up to four arguments |
| `on: eventType do: block` | Register an event callback in the current host scope |
| `isUndefined` | Test for the wrapped JavaScript undefined value |

Host call results pass through the same value conversion.  Exceptions pause
at the send.  A promise-returning call waits for its result.  A property read
returns its value, including a wrapped promise if the property contains one.

### Asynchronous operations

```js
import { Host, ProcessRunner, Runtime } from './src/index.js';

const runtime = new Runtime();
const runner = new ProcessRunner(runtime);
const host = new Host(runtime, runner);
const service = host.value({ answer: async () => 42n });
const processId = runtime.start(service, 'call:', ['answer']);
console.log(runtime.run(processId).status);
await runtime.whenReady(processId);
const state = runtime.resume(processId);
if (state.stop.reason === 'error') throw state.stop.error;
console.log(state.status, state.result);
runtime.dispose(processId);
runner.close();
```

Pending host work retains its runtime until completion or cancellation.
Cancellation releases that reference even if the host promise remains pending.

The output is `waiting`, followed by `completed 42n`.  `whenReady` resolves
after success, rejection, or cancellation changes the process state.  A
successful call advances past the send.  A rejected call pauses with an error
at the same send and keeps its operands.  `retry` invokes it again, so the host
operation can repeat effects.  Earlier Smallslop instructions keep their
effects.  Stepping stops at the requested point after a call completes.

A host method or primitive can return
`new HostOperation(promise, {cancel: () => controller.abort()})` to support
cancellation.  Cancellation invalidates the wait before invoking the handler
and ignores late success or rejection.  Cancellation-handler errors reach
the caller after the process becomes cancelled.  A plain promise supplies
no host cancellation handler.  In that case, cancelling the process prevents
resumption while the host work follows its own lifetime.

### Scheduling and callback ownership

`new ProcessRunner(runtime, {budget: 1000, onChange})` schedules one bounded
interpreter batch per timer task.  `runner.follow(processId)` continues a
new process, a budget stop, or a waiting operation.  It stops automatic
execution at a breakpoint, error, completed step, explicit pause, or process
completion.  `onChange(processId)` reports each batch or asynchronous state
change.  After a debugger command, calling `follow` updates scheduling from
the resulting process state.  `runner.forget(id)` removes scheduling for one
process.  `runner.close()` stops the runner's scheduled work.

`host.scope()` creates an owner for listeners and processes.
`scope.start(receiver, selector, args)` creates and schedules a process.
`runtime.start` and `runtime.evaluate` also accept `{scope}` in their options.
Frame evaluation inherits its selected process's scope.  A callback block
accepts zero arguments or one wrapped Event argument.  Each event queues a
new process.  Its captured bindings remain shared after the registering
method returns.  Event callbacks execute after dispatch, so synchronous
event cancellation belongs in host code.

`scope.listen(target, type, block)` returns a listener-removal function.
`scope.reap({keep: processId, retain: processIds})` disposes completed or cancelled
processes, retaining the optional process and IDs in the optional Set or Map.
`scope.dispose()` removes its
listeners, cancels pending processes, and disposes their records.  It reports
cleanup failures through `AggregateError` after attempting every cleanup.
Debugger object handles have a separate lifetime and use `release` or
`releaseAll`.

### Compiling and assembling code

`compileMethod(klass, source)` returns `{selector, code}` for later installation
with `runtime.install(klass, selector, code)`.  `compileExpression(klass, source)`
returns a `Code` object for an evaluated expression.  Compilation resolves
class names against that runtime's class registry.

A `Code` object contains `args`, `locals`, `bytes`, `literals`, `source`,
`positions`, and instruction `boundaries`.  Code arrays and position records
are frozen.  Literal object references retain their identity and state.
Validation checks instruction shapes, literal references, jump targets, and
operand-stack depth along reachable paths.

```js
import { Code, Runtime, assemble } from './src/index.js';

const runtime = new Runtime();
const code = new Code({
  literals: [42n],
  bytes: assemble([['constant', 0], ['return']]),
});
console.log(runtime.run(runtime.startCode(null, code)).result);
```

The result is `42n`.  `assemble` accepts instruction arrays and resolves
`['label', name]` declarations used by jumps.  An opcode occupies one byte.
Each operand occupies two bytes in big-endian order and has range 0 through
65,535.  `pc` and jump destinations are byte offsets.  `decode(bytes, pc)`
returns `{op, name, args, next}`.

| Instruction | Operands | Behavior |
| --- | --- | --- |
| `constant` | Literal index | Push the literal value |
| `self` | None | Push the receiver |
| `read` | Lexical depth, binding index | Push a binding's value |
| `write` | Lexical depth, binding index | Store the stack's top value in a binding, retaining the value on the stack |
| `slot` | Literal index of a slot name | Push a receiver slot's value |
| `storeSlot` | Literal index of a slot name | Store the stack's top value in a receiver slot, retaining it on the stack |
| `send` | Selector literal index, argument count | Send to the receiver beneath the arguments on the stack |
| `superSend` | Selector literal index, argument count | Send through the defining class's superclass |
| `block` | Literal index of a `Code` object | Capture the current environment in a new block |
| `pop` | None | Discard the stack's top value |
| `return` | None | Return the stack's top value from the current invocation |
| `nonlocalReturn` | None | Return the stack's top value from the block's home method activation |
| `jump` | Byte offset or assembler label | Continue at the destination |
| `jumpFalse` | Byte offset or assembler label | Pop a Boolean and branch when false |

Lexical depth zero denotes the current environment.  Binding indexes start
at zero, with arguments followed by locals.  Greater depths select captured
environments.  A successful send consumes its receiver and arguments.
An ordinary return supplies one result to the caller's operand stack.

## Further work

| Area | Pending work |
| --- | --- |
| Language and library | Cascades, symbols, literal arrays, collection methods, integer `/`, and fractions |
| Object model | Per-class metaclasses and instance-layout migration |
| Debugger | Source-level stepping and invocation restart |
| Host access | Constructors, module imports, host symbols, and callbacks requiring synchronous return values |
| Persistence | Classes outside installed components, saved object graphs, suspended execution, and host-resource reconstruction |
| Optimization | Profiling and optional per-method JavaScript compilation |

The [README](../README.md) provides a shorter API overview.  The
[development notes](../devnotes.md) record decisions and test results.
