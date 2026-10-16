# Smallslop Manual

Smallslop is a Smalltalk-like language implemented as a bytecode interpreter
in JavaScript.  The same ES modules run in Node and browsers.  Classes, method
versions, lexical environments, and call frames are runtime objects.  The
debugger inspects, steps, edits, and retries execution through JavaScript and
JSON APIs.

This manual covers the language, classes, processes, the debugger, embedding,
the browser tools in `ui/`, and the server runtime in `server/world.mjs`.
[Agent and Web Server](agent.md) covers the Web server, page sessions, and the
agent, and [Components](components.md) covers installed JavaScript components.
The [README](../README.md#setup-and-commands) lists the setup and commands.

## Evaluating an expression in Node

`evaluate` compiles source and creates a paused process.  `run` executes the
process and returns a state record, and a completed process's `result` is a
JavaScript value.  This command prints `42n`, Node's display of an exact
integer:

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

The default receiver for an evaluated expression is `nil`.  The JavaScript
examples below are independent Node ES modules, except the browser-console
example.  Each can be saved in a `.mjs` file at the repository root and run
with `node`, or passed to `node --input-type=module` on standard input.
Smallslop examples marked `smalltalk` are source strings for `evaluate`,
unless described as method definitions.

## Source language

### Values and numeric types

| Smallslop source | Class | JavaScript representation |
| --- | --- | --- |
| `42`, `-7`, `9007199254740993` | `Integer` | `BigInt` |
| `16r1F`, `2r1010`, `-36rZ` | `Integer` | `BigInt`, written in radix 2 through 36 with digits and capital letters |
| `42.0`, `-0.25`, `2e3`, `1.5d2`, `2.5q-1` | `Float` | `Number`.  The ANSI exponent letters `e`, `d`, and `q` select one representation. |
| `'text'`, `'it''s a string'` | `String` | String |
| `#name`, `#at:put:`, `#+`, `#'two words'` | `Symbol` | An interned object.  Two symbols with the same characters are the same object. |
| `$a`, `$ ` | `Character` | An interned object for one code point |
| `#(1 $a 'b' #c #(2) nil)` | `Array` | A frozen JavaScript array |
| `true`, `false` | `True`, `False` | Boolean |
| `nil` | `UndefinedObject` | `null` |
| `[42]` | `Block` | A block with its captured environment |
| `Object` | `Object class` | The class registered under that name.  Its class is its metaclass. |

Double quotes delimit comments.  Names use ASCII letters, digits, and
underscores, with a letter or underscore first.  Local and slot names resolve
before class names.  `self`, `super`, `nil`, `true`, and `false` have reserved
meanings.

The compiler turns any other name that starts with a capital letter, or that
names an existing class, into a run-time lookup in the runtime's class table.
A method can therefore name a class that does not exist yet.  If the class is
still missing when the lookup runs, the process suspends with an
`UndefinedName` error whose `variable` is the name, and `retry` repeats the
lookup after the class is defined.  Any other unknown name is a compile error.

Integer arithmetic preserves exact results.  Arithmetic and ordering require
operands of the same numeric class.  `asFloat` converts an Integer to a Float
and can lose precision.  JavaScript callers pass `42n` for an Integer and `42`
for a Float.

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

A message has a receiver, a selector, and zero or more arguments.  The
selector identifies the method to look up.  Lookup starts at the receiver's
class and follows the superclass chain.

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

Periods separate statements.  A final period is allowed.  A method returns its
receiver unless it executes `^expression`.  The compiler rejects a statement
after a return in the same statement sequence.  A method can send other
messages through `self`.  A `super` send starts lookup at the superclass of
the class that defined the current method, while keeping the receiver.

A cascade sends several messages to one receiver, separated by semicolons
(ANSI §3.4.5.3.3).  The receiver is the receiver of the last message before
the first semicolon, and the cascade's value is the value of its last message.
`Counter new increment; increment; count` sends all three messages to the new
counter, and `3 + 4; * 10` evaluates to `30`.  When that receiver is `super`,
every message in the cascade is a `super` send.

A literal array contains literals, nested literal arrays, `nil`, `true`, and
`false` (ANSI §3.4.6.6).  Write a symbol inside it as `#name`, because the
compiler rejects other bare names, whose meaning ANSI leaves undefined.  The
array is frozen, because ANSI leaves the effect of changing a literal
undefined (§3.4.6).  `copy` returns a changeable array.

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

### Control flow

Conditions and loops use message sends.  A Boolean conditional invokes the
selected block and returns its result.  A one-branch conditional returns `nil`
when its branch is skipped.  `and:` and `or:` evaluate their argument block
only when its result is needed.

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
frame and yields when its process exhausts the instruction budget.  `to:do:`,
`to:by:do:`, and `timesRepeat:` are ordinary methods written in Smallslop.

## Class library

The class library follows the ANSI protocols where ANSI defines them and
Smalltalk-80 where it does not.  Most of it is Smallslop source in
[`src/library.js`](../src/library.js), which the System Browser shows and the
debugger steps through.  A small set of primitives in
[`src/primitives.js`](../src/primitives.js) and
[`src/kernel.js`](../src/kernel.js) supplies arithmetic, indexing, string
operations, and stream buffers.  Primitives cannot send messages, so every
method that runs a block per element or calls a user's `=` or `hash` is
Smallslop source.

| Class | Superclass | Representation |
| --- | --- | --- |
| `Magnitude` | `Object` | Abstract comparisons from `<` |
| `Number` | `Magnitude` | Abstract arithmetic, rounding, and intervals |
| `Integer`, `Float` | `Number` | JavaScript `BigInt` and `Number` |
| `Fraction` | `Number` | `numerator` and `denominator` Integers, reduced, with a positive denominator |
| `Character` | `Magnitude` | Interned code point |
| `Collection`, `SequenceableCollection`, `ArrayedCollection` | | Abstract collection protocols |
| `Array` | `ArrayedCollection` | JavaScript array |
| `String`, `Symbol` | `ArrayedCollection`, `String` | JavaScript string, and interned symbol |
| `OrderedCollection`, `SortedCollection` | `SequenceableCollection`, `OrderedCollection` | JavaScript array in a slot |
| `Interval` | `SequenceableCollection` | `start`, `stop`, and `step` |
| `Set`, `Bag`, `Dictionary`, `IdentityDictionary` | `Collection`, `Dictionary` | Hash buckets written in Smallslop |
| `Association` | `Object` | `key` and `value` |
| `Stream`, `ReadStream`, `WriteStream` | `Object`, `Stream` | A collection and position, and a primitive buffer |
| `Exception` and its subclasses, `ExceptionSet`, `Message` | `Object` | Smallslop source in [`src/exceptions.js`](../src/exceptions.js) with interpreter primitives (see [Exceptions](#exceptions)) |

### Objects and classes

| Receiver | Messages |
| --- | --- |
| Every object | `yourself`, `class`, `==`, `~~`, `=`, `~=`, `hash`, `identityHash`, `copy`, `isNil`, `notNil`, `isKindOf:`, `isMemberOf:`, `respondsTo:`, `perform:` through `perform:with:with:with:`, `perform:withArguments:`, `error:`, `doesNotUnderstand:`, `printOn:`, `printString`, `->`, `subclassResponsibility`, `shouldNotImplement`, and the tests `isString`, `isSymbol`, `isNumber`, `isInteger`, `isFloat`, `isFraction`, `isCharacter`, `isArray`, `isCollection` |
| Every class | `new`, `basicNew`, `name`, `category`, `superclass`, `subclasses`, `allSubclasses`, `allSuperclasses`, `instVarNames`, `allInstVarNames`, `selectors`, `includesSelector:`, `canUnderstand:`, `inheritsFrom:` |
| Metaclass | `soleInstance` |
| Boolean | `not`, `&`, `|`, `eqv:`, `xor:`, `ifTrue:`, `ifFalse:`, `ifTrue:ifFalse:`, `ifFalse:ifTrue:`, `and:`, `or:` |
| Block | `value` through `value:value:value:value:`, `valueWithArguments:`, `argumentCount`, `numArgs`, `whileTrue`, `whileFalse`, `whileTrue:`, `whileFalse:` |

The `<Object>` messages follow ANSI §5.3.1, and `name`, `superclass`,
`subclasses`, `allSubclasses`, and `allSuperclasses` follow ANSI §5.3.8.  The
other class messages come from Smalltalk-80.  `perform:` and its variants take
the selector as a Symbol or String and send it as if the message appeared in
source, so a missing method suspends at the `perform:` send and `retry`
repeats it.  `copy` returns a shallow copy of an object, array, or ordered
collection, and returns other values unchanged.  `error:` signals an `Error`
with its argument as the message text, and `doesNotUnderstand:` signals
`MessageNotUnderstood` (see [Exceptions](#exceptions)).

The initial `=` sends `==`, which uses JavaScript strict equality.  Distinct
ordinary objects compare by identity, and Strings, Integers, and Floats
compare by value and class, so `1 = 1.0` is false.  `hash` and `identityHash`
return Integers.  Objects that are `=` have equal hashes, and `0.0` and `-0.0`
hash alike.  A class that replaces `=` must replace `hash` to match, because
`Set` and `Dictionary` find elements by hash.

### Numbers

| Receiver | Messages |
| --- | --- |
| Every number (ANSI §5.6.2) | `+`, `-`, `*`, `/`, `//`, `\\`, `quo:`, `rem:`, `<`, `<=`, `>`, `>=`, `=`, `between:and:`, `max:`, `min:`, `abs`, `negated`, `negative`, `positive`, `strictlyPositive`, `sign`, `isZero`, `even`, `odd`, `squared`, `sqrt`, `reciprocal`, `raisedTo:`, `raisedToInteger:`, `floor`, `ceiling`, `truncated`, `rounded`, `roundTo:`, `truncateTo:`, `integerPart`, `fractionPart`, `asInteger`, `asFloat`, `asFloatD`, `asFloatE`, `asFloatQ`, `asFraction`, `asString`, `printString`, `to:`, `to:by:`, `to:do:`, `to:by:do:` |
| Integer (ANSI §5.6.5) | `gcd:`, `lcm:`, `factorial`, `bitAnd:`, `bitOr:`, `bitXor:`, `bitShift:`, `bitAt:`, `bitAt:put:`, `highBit`, `allMask:`, `anyMask:`, `noMask:`, `printStringRadix:`, `printOn:base:showRadix:`, `numerator`, `denominator`, `asCharacter`, `timesRepeat:` |
| Float (ANSI §5.6.7) | `exp`, `ln`, `log:`, `sin`, `cos`, `tan`, `arcSin`, `arcCos`, `arcTan`, `degreesToRadians`, `radiansToDegrees`, `floorLog:`, `isNaN` |
| Fraction (ANSI §5.6.4) | `numerator`, `denominator`, and class-side `numerator:denominator:` |

Integer `/` returns a `Fraction` reduced to lowest terms, or an Integer when
the result is whole, as ANSI §5.6.2.4 requires, so `6 / 3` is `2` and `3 / 6`
prints as `1/2`.  Integers and fractions mix exactly in every operation.  A
Float operand with an Integer or Fraction is an error, so write `2 asFloat +
0.5`.  ANSI converts mixed operands implicitly (§5.6.2.4), so this rule
departs from the standard.  `//` and `\\` floor, `quo:` and `rem:` truncate,
and division by zero suspends with a `ZeroDivide` error.  `rounded` rounds
halves away from zero (ANSI §5.6.2.31), and `asInteger` is `rounded`.
`raisedTo:` with an Integer exponent is exact, including negative exponents,
which return fractions.  `sqrt` returns a Float.

Floats print with a decimal point and an exponent when JavaScript uses one:
`2.0`, `0.1`, `1.0e21`, `-0.0`, `NaN`, and `Infinity`.  `printStringRadix: 16`
prints `16rFF`, and `printOn:base:showRadix:` prints the digits with or
without the radix prefix.

### Characters, strings, and symbols

| Receiver | Messages |
| --- | --- |
| Character (ANSI §5.3.4) | `=`, `<`, `<=`, `>`, `>=`, `codePoint`, `value`, `asInteger`, `asCharacter`, `asString`, `asSymbol`, `asUppercase`, `asLowercase`, `isLetter`, `isDigit`, `isAlphaNumeric`, `isUppercase`, `isLowercase`, `isVowel`, `isSeparator` |
| Character class (ANSI §5.3.5) | `codePoint:`, `cr`, `lf`, `space`, `tab` |
| String (ANSI §5.7.10) | `size`, `at:`, `,`, `=`, `<`, `<=`, `>`, `>=`, `sameAs:`, `asUppercase`, `asLowercase`, `asSymbol`, `asString`, `indexOf:`, `copyFrom:to:`, `reverse`, `subStrings:`, `subStrings`, `printString`, and the sequenced collection messages that do not change the receiver |
| String class | `new`, `new:`, `with:` through `with:with:with:with:`, `withAll:` |
| Symbol (ANSI §5.7.11) | `asString`, `asSymbol`, `numArgs`, and the String messages |

A String is an immutable JavaScript string, so it conforms to ANSI
`<readableString>` and has no `at:put:`.  ANSI `<String>` includes `at:put:`
(§5.7.12), so this is a departure from the standard.  Operations that produce
text, such as `,`, `copyReplaceAll:with:`, `collect:`, and `reverse`, return
new strings, and `WriteStream` builds text in pieces.  `at:` returns a
Character for one UTF-16 code unit, so a character outside the Basic
Multilingual Plane occupies two positions.  `String new: 3` returns three
spaces.  `'abc' = #abc` is false, because ANSI `=` for sequences requires the
same class.  `collect:` on a string must produce Characters.

### Collections

| Receiver | Messages |
| --- | --- |
| Every collection (ANSI §5.7.1) | `do:`, `do:separatedBy:`, `size`, `isEmpty`, `notEmpty`, `includes:`, `occurrencesOf:`, `collect:`, `select:`, `reject:`, `detect:`, `detect:ifNone:`, `inject:into:`, `allSatisfy:`, `anySatisfy:`, `asArray`, `asBag`, `asOrderedCollection`, `asSet`, `asSortedCollection`, `asSortedCollection:`, `rehash` |
| Sequenced collections (ANSI §5.7.8, §5.7.12) | `at:`, `at:ifAbsent:`, `first`, `last`, `after:`, `before:`, `indexOf:`, `indexOf:ifAbsent:`, `indexOfSubCollection:startingAt:`, `findFirst:`, `findLast:`, `,`, `=`, `copyFrom:to:`, `copyWith:`, `copyWithout:`, `copyReplaceAll:with:`, `copyReplaceFrom:to:with:`, `copyReplaceFrom:to:withObject:`, `copyReplacing:withObject:`, `reverse`, `reverseDo:`, `keysAndValuesDo:`, `from:to:do:`, `from:to:keysAndValuesDo:`, `with:do:`, and, where the receiver can change, `at:put:`, `atAll:put:`, `atAllPut:`, `replaceFrom:to:with:`, `replaceFrom:to:with:startingAt:`, `replaceFrom:to:withObject:` |
| Array class | `new`, `new:`, `with:` through `with:with:with:with:`, `withAll:` |
| OrderedCollection (ANSI §5.7.18) | `add:`, `addFirst:`, `addLast:`, `add:after:`, `add:before:`, `add:afterIndex:`, `add:beforeIndex:`, `addAll:`, `addAll:after:`, `addAll:before:`, `addAll:afterIndex:`, `addAll:beforeIndex:`, `addAllFirst:`, `addAllLast:`, `remove:`, `remove:ifAbsent:`, `removeAll:`, `removeFirst`, `removeLast`, `removeAtIndex:` |
| SortedCollection (ANSI §5.7.17) | `add:`, `sortBlock`, `sortBlock:`, and class-side `sortBlock:` |
| Interval (ANSI §5.7.9) | Class-side `from:to:` and `from:to:by:`; `Number>>to:` and `to:by:` create intervals |
| Set and Bag (ANSI §5.7.6, §5.7.7) | `add:`, `addAll:`, `remove:`, `remove:ifAbsent:`, `removeAll:`, and `add:withOccurrences:` on Bag |
| Dictionary (ANSI §5.7.2, §5.7.3) | `at:`, `at:ifAbsent:`, `at:ifAbsentPut:`, `at:put:`, `includesKey:`, `keyAtValue:`, `keyAtValue:ifAbsent:`, `keys`, `values`, `keysAndValuesDo:`, `keysDo:`, `associationsDo:`, `removeKey:`, `removeKey:ifAbsent:`, `removeAllKeys:`, `removeAllKeys:ifAbsent:`, `addAll:`, `collect:`, `select:`, `reject:` |
| Association | `key`, `value`, `key:`, `value:`, class-side `key:value:` |

`Set`, `Bag`, and `Dictionary` find elements and keys with `=` and `hash`.
`IdentityDictionary` uses `==` and `identityHash`.  A literal array is frozen,
and `at:put:` on it is an error; `copy` returns a changeable array.
`collect:` returns a collection like the receiver, as ANSI §5.7.1.10 requires:
a String for a string, an Array for an array or interval, a Set for a set, and
a Dictionary with the same keys for a dictionary.  An interval's elements are
computed from `start` and `step`, and a step of zero is an error.
`SortedCollection` rejects `addFirst:`, `addLast:`, and `at:put:`, and
`select:` keeps its sort block.  `Dictionary keys` returns a Set, and `values`
returns an Array.

### Streams

| Receiver | Messages |
| --- | --- |
| ReadStream (ANSI §5.9.2, §5.9.5) | `next`, `next:`, `peek`, `peekFor:`, `nextMatchFor:`, `nextLine`, `upTo:`, `upToEnd`, `skip:`, `skipTo:`, `atEnd`, `do:`, `contents`, `position`, `position:`, `reset`, `setToEnd`, `isEmpty`, `close`, and class-side `on:` |
| WriteStream (ANSI §5.9.4, §5.9.6) | `nextPut:`, `nextPutAll:`, `print:`, `cr`, `space`, `tab`, `contents`, `reset`, `flush`, `close`, and class-side `on:` and `with:` |

A WriteStream writes to a String, an Array, or an OrderedCollection.
`WriteStream on:` starts empty, and `with:` starts with the collection's
elements, as ANSI §5.9.11 defines.  A String stream accepts Characters in
`nextPut:` and Strings or Symbols in `nextPutAll:`.  `cr` writes a line feed,
the end-of-line sequence that ANSI leaves to the implementation.  `ReadStream
next` past the end is an error, and `peek` there returns `nil`.

### Printing

`printString` writes `printOn:` to a String stream.  Integers print their
digits, Floats as described above, and Fractions as `3/4`.  Strings print
quoted with doubled quotes, Symbols as `#name` or `#'two words'`, and
Characters as `$a`.  `nil`, `true`, and `false` print their names, classes
print their names, and an Association prints as `key->value`.  An Array prints
in literal form, `#(1 $a 'b' #c)`.  Another collection prints its class with
an article, followed by its elements in parentheses, as in `an
OrderedCollection(1 2 3)`; a Dictionary prints as `Dictionary(#a->1)`, and an
Interval as `(1 to: 9 by: 2)`.  Other objects print as `a ClassName` or `an
ClassName`, by the first letter of the class name.

## Classes and method installation

`defineClass` creates an ordinary class.  Its default superclass is `Object`,
and its optional `category` names the browser group and defaults to
`Unclassified`.  Slots include inherited slots and begin as `nil`.  Slot names
must be distinct across the inheritance chain.  `newObject` allocates an
instance, and the source message `Counter new` performs the same allocation.
`new` succeeds for `Object` and classes defined with `defineClass`.  Sent to
any other built-in class, such as `Integer`, `String`, `Block`, or `Class`, or
to a subclass of one, it suspends with an error, because the instances of
those classes come from literals, blocks, and host values.

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

The output is `1n` on each line.  Allocation initializes slots to `nil`.  The
example sends `initialize` as a separate operation.

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
owner, selector, arity, and compiled `code`.  `lookup(klass, selector)`
searches the class and its ancestors and returns a method or `null`.

Each class has a metaclass, which holds its class-side methods and class
instance variables.  `Point class` evaluates to the metaclass, whose name is
`Point class`.  Metaclasses parallel the class hierarchy: `Point3 class
superclass` is `Point class`, `Object class superclass` is `Class`, and every
metaclass is an instance of `Metaclass`.  A message sent to a class looks
first in its metaclass, then in its superclasses' metaclasses, then in `Class`
and `Object`, so every class understands `new` and the reflection messages.

```js
import { Runtime } from './src/index.js';

const runtime = new Runtime();
const point = runtime.defineClass('Point', { slots: ['x', 'y'], classSlots: ['made'] });
runtime.installSource(point, 'setX: newX y: newY x := newX. y := newY');
runtime.installSource(point, 'x ^x');
runtime.installSource(point.metaclass,
  'x: newX y: newY made := (made isNil ifTrue: [0] ifFalse: [made]) + 1. ^self new setX: newX y: newY');
runtime.installSource(point.metaclass, 'made ^made');
console.log(runtime.run(runtime.evaluate('(Point x: 3 y: 4) x')).result);
console.log(runtime.run(runtime.evaluate('Point made')).result);
```

The output is `3n`, followed by `1n`.  `classSlots` names class instance
variables, which class-side methods read and assign like slots.  Each class
has its own values, so a subclass starts with its own `nil`.
`runtime.classNamed('Point class')` returns a metaclass, and
`runtime.behaviors()` returns every class and metaclass.  `new` sent to a
metaclass fails, because a metaclass has exactly one instance, its class.

`installSource`, `install`, and `primitive` accept an optional final options
object with a `protocol` name.  Replacement preserves the current protocol
when that option is omitted.  A new selector defaults to `unclassified`.
Method descriptions distinguish `source`, `bytecode`, and `primitive` forms.

`installSource` also accepts `expectedMethodId` and `selector`.  The expected
ID must match the installed version.  `null` requires an unused selector.  The
optional selector requires the source to retain that selector.  Failed
validation leaves the installed method unchanged.

Installing the same selector creates a new immutable method version.  New
sends find that version.  An invocation already in progress keeps its previous
version, source, and instruction positions.  Breakpoints belong to a method
version and remain attached to that version after replacement.
`runtime.methods` indexes versions through weak references.  A class's method
dictionary, active frame, escaped block, breakpoint, or explicit debugger
reference keeps a version alive.  Unreferenced versions can be collected.

## Class definitions and source files

`redefineClass(klass, options)` changes an existing class.  Its options are
`superclass`, `slots`, `classSlots`, and `category`, which name the class's
own slots and class instance variables, as in `defineClass`.  An omitted
option keeps its current value.  The class keeps its identity, methods,
instances, and class instance variable values, and its subclasses inherit the
new layout.  An existing instance keeps its slot values.  A slot added to its
layout reads as `nil` until assigned.

When the superclass or a slot list changes, the runtime recompiles every source
method of the class, its subclasses, and their metaclasses.  A method that no
longer compiles keeps its previous version, and `redefineClass` returns one
record per such method with `className`, `selector`, and `message`.  A kept
version that names a removed slot suspends with `Unknown instance slot` when
it runs.  `Object`, the kernel classes with native instances, and metaclasses
cannot be redefined.  A cycle in the hierarchy or a slot name defined twice in
one inheritance chain throws an error and leaves every class unchanged.

Smallslop reads and writes the ANSI interchange format (ANSI draft section
4).  A file starts with the version element, and each element ends with `!`.
A `!` inside an element is written as `!!`.

```
Smalltalk interchangeVersion: '1.0'!
Class named: 'Point3'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'x y'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Graphics'!

Point3 method!
x
  ^x!
Annotation key: 'category' value: 'accessing'!

Point3 method!
setX: newX y: newY
  x := newX.
  y := newY!
Annotation key: 'category' value: 'initializing'!

Point3 classMethod!
x: newX y: newY
  ^self new setX: newX y: newY!
Annotation key: 'category' value: 'instance creation'!
```

The reader accepts the version element, class definitions, method and class
method definitions, comments, and annotations.  A `category` annotation names
a class's category or a method's protocol.  The reader ignores other
annotations, such as `comment` and `author`.  It rejects global, pool, and
initializer elements, class variables, shared pools, and indexed instance
variables other than `#none`.

| Function | Result |
| --- | --- |
| `fileIn(runtime, text)` | Defines or redefines the classes, then installs the methods.  It returns `{classes, methods, failures}`. |
| `fileOut(klass)` | Interchange text for the class, its definition, and its source methods, sorted by selector |
| `classDefinition(klass)` | The class definition element and its category annotation |
| `parseInterchange(text)` | The elements of a file, without changing a runtime |

A file in continues past a failed class definition or method and records each
failure with its class name and message.  A malformed file throws a
`SyntaxError` with the character offset of the element.  `fileOut` lists
bytecode and primitive methods in a comment, because they have no source.

`loadSourceDirectory(runtime, directory)` in
[`server/source-files.mjs`](../server/source-files.mjs) reads every `.st` file
in a directory.  It defines each class after its superclass, regardless of
file order, then installs the methods of every file.  Each failure record
names its file.  `writeClassFile(klass, directory)` writes `fileOut(klass)` to
`ClassName.st`, replacing an existing file in one rename.

## Exceptions

Smallslop implements the exception protocols of ANSI section 5.5.  `[...]
on: selector do: [:exception | ...]` evaluates the receiver block with a
handler.  The selector is an exception class, which handles its instances and
its subclasses' instances, or an `ExceptionSet` built with `,`.  The handler
block takes one argument, as ANSI requires.  When the handler block returns,
its value becomes the value of `on:do:`.

```smalltalk
[10 / 0] on: ZeroDivide do: [:e | e return: e dividend]
[(Warning signal: 'low') + 1] on: Warning do: [:e | e resume: 1]
[Error signal: 'first'] on: ZeroDivide, Error do: [:e | e messageText]
```

The results are `10`, `2`, and `'first'`.

| Class | Superclass | Resumable | Unhandled |
| --- | --- | --- | --- |
| `Exception` | `Object` | Yes | Pauses the process at the failed instruction |
| `Error` | `Exception` | No | Pauses the process at the failed instruction |
| `ZeroDivide` | `Error` | Yes | Pauses the process at the failed instruction |
| `MessageNotUnderstood` | `Error` | Yes | Pauses the process at the failed send |
| `Notification` | `Exception` | Yes | The signal returns `nil` |
| `Warning` | `Notification` | Yes | Pauses the process.  `resume` returns `nil` from the signal. |

| Message | Effect |
| --- | --- |
| `signal`, `signal:` | Signal the exception, optionally with message text.  Exception classes understand both. |
| `messageText`, `description`, `tag` | The signaler's text or `nil`, a description that defaults to the class name, and the tag or the text |
| `return:`, `return` | Return a value, or `nil`, from the handler's `on:do:` |
| `retry`, `retryUsing:` | Evaluate the protected block, or a replacement block, again under the same handler |
| `resume:`, `resume` | Return a value, or `nil`, from the signal, or from `outer` when the handler was reached through `outer`.  Requires a resumable exception. |
| `pass` | Give the exception to the enclosing handler, or to the default action |
| `outer` | Evaluate the enclosing handler or the default action, and return its resumption value |
| `resignalAs:` | Signal a replacement exception from the original signal point |
| `isNested` | Answer whether an enclosing handler handles the exception |

A handler block runs above the signaling frames, so `resume:` can return to
the signal point.  An exception signaled inside a handler block reaches only
the handlers that enclose that handler's `on:do:`.  The default action runs in
the exception environment of the signal.  `ensure:` evaluates its argument
after the receiver block returns, after a non-local return leaves it, and
after a handler's return, retry, or resignal, or a process cancellation, ends
it.  `ifCurtailed:` evaluates its argument only when the receiver block ends
without returning.  Termination blocks run innermost first, after the handler
that ended their blocks.

Interpreter and primitive failures signal exceptions.  A missing method sends
`doesNotUnderstand:` with a `Message` that holds the selector and arguments,
and `Object>>doesNotUnderstand:` signals `MessageNotUnderstood`.  Its
resumption value becomes the value of the failed send.  Integer division by
zero signals `ZeroDivide` with the dividend.  Other primitive failures,
undefined global names, unknown slots, and rejected host operations signal
`Error` with the failure's text as `messageText`.

An unhandled `Error` pauses the process with `stop.reason` `'error'`.  The
runtime unwinds the signal and handler frames, running their termination
blocks, and restores the failed instruction with its operands.  For an
explicit signal, the failed instruction is the send that entered the
exception classes' methods, such as `Error signal: 'x'` in user code or the
`signal:` send inside `Object>>error:`.  `stop.error` holds the original
JavaScript failure or an `Error` named after the exception class, and
`stop.exception` holds the exception.  `retry` executes the instruction again.
An unhandled `Warning` pauses with `stop.reason` `'warning'` and
`stop.message`.  `resume` continues with `nil` as the value of the signal, and
`cancel` ends the process.

`runtime.stopOnSignal = true`, the `stopOnSignal` debugger request, and the
Debugger pane's Stop on signal checkbox pause every signal before its handler
search, with `stop.reason` `'signal'`.  `resume` continues the search.

`cancel(id, {budget, unwind})` runs the process's pending termination blocks
within the budget.  When a termination block stops at an error, breakpoint,
wait, or the budget, the process keeps that state, and cancellation finishes
when the termination blocks finish.  Another `cancel` continues with the
remaining termination blocks.  Each termination block runs at most once.
`unwind: false` discards the frames without running termination blocks.
Host scope disposal does so after it reports a process whose termination
blocks did not finish.

Smallslop resolves several cases that ANSI leaves to the implementation.  A
signal sent to an exception that is already signaled starts a new signal.
When the default action of a non-resumable exception returns, the signal
returns its value.  A failure in an instruction other than a send cannot
resume, so a return from its signal pauses the process with an error.  A
failure while 32 failure signals are active pauses the process at that
failure without signaling, which stops recursion in faulty exception methods.

## Processes and the debugger

### Process state and execution

`start(receiver, selector, args = [])`, `evaluate(source, options = {})`, and
`startCode(receiver, code)` create paused processes and return process IDs.
`start` prepares a message send.  `evaluate` compiles an expression sequence
whose final value becomes the process result.  `startCode` accepts compiled
code with no arguments.

`inspect(id)` returns `{id, status, stop, result, action, frames}`.  Each call
to `run` or a stepping operation returns the same record shape.  `result`
holds the return value when `status` is `completed`.

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
| `error` | An instruction failed without signaling, or an unhandled `Error` restored its failed instruction.  `stop.error` holds the failure, and `stop.exception` holds a signaled exception. |
| `warning` | An unhandled `Warning` paused the process.  `stop.message` holds its description. |
| `signal` | Stop on signal paused before a handler search.  `stop.exception` holds the exception. |
| `cancelling` | Cancellation is running termination blocks |
| `return` | The process completed |
| `cancelled` | The process was cancelled |

`run(id, {budget: 10000})` executes up to 10,000 bytecodes by default.  The
budget must be a positive safe integer.  A host can schedule processes in
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

The output is `completed 5050n`.  Instruction budgets count bytecodes.  A
synchronous primitive finishes before the interpreter checks the next
instruction.  Pausing one process leaves other processes available to the
host.  The runtime retains process records in `runtime.processes` until
`dispose(id)` removes a completed or cancelled process.  A paused process must
be cancelled before disposal.  Disposal releases the runtime's reference to
that record.  A result retained by application code remains usable.

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
| `cancel(id, {budget, unwind})` | Cancel a paused or waiting process after running its termination blocks |
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
division fails leaves the pending argument unchanged.  `setSendOperand` can
replace that argument before retry without repeating prior expressions.  The
receiver of a super send remains the frame's receiver.  `retry` executes the
failed instruction before checking its breakpoint again.

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

The output is `breakpoint 3n`, followed by `42n`.  The breakpoint stops the
process before the method's first instruction.  `setVariable` replaces the
argument before the multiplication reads it.

`evaluate(source, {processId, frameId})` creates a separate process that
shares the paused frame's receiver and lexical bindings.  Omitting `frameId`
selects the current frame.  Running the evaluation leaves the original process
paused.  The evaluation has its own return activation.  Its local declarations
can shadow the paused frame's bindings.

### Repairing a failed send

Syntax and name-resolution errors throw `SyntaxError` with `position`, `line`,
and `column`.  The position is a zero-based JavaScript string offset.  Line
and column numbers start at one.  Invalid debugger operations throw to their
JavaScript caller.  An unhandled execution error suspends the process with
`stop.reason === 'error'`.

An unhandled `MessageNotUnderstood` gives `stop.error` the name
`MessageNotUnderstood` with `receiver`, `selector`, and `arguments`.  The
failed send keeps its instruction position and operands.  The debugger can
install a method and retry from that position:

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

## JSON debugger API

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

An adapter's `value(value)` method encodes a supported runtime value.  Its
`decode(record)` method restores that value within the adapter.  Encoded
records are plain JSON, so a transport can pass them without further
conversion.

| Value | Encoding |
| --- | --- |
| `nil` | `{"kind":"nil"}` |
| Integer | `{"kind":"integer","value":"42"}` |
| Finite Float | `{"kind":"float","value":2.5}` |
| Special Float | `{"kind":"float","value":"-0"}`, with `"NaN"`, `"Infinity"`, or `"-Infinity"` as the other special values |
| Boolean | `{"kind":"boolean","value":true}` |
| String | `{"kind":"string","value":"text"}` |
| Symbol | `{"kind":"symbol","value":"at:put:"}` |
| Character | `{"kind":"character","value":97}`, with the code point |
| Object reference | `{"kind":"object","id":1,"className":"Counter"}`, with an ID allocated by the adapter |

Process, frame, method, and breakpoint IDs belong to the runtime.  Object
handle IDs belong to a debugger adapter.  Their numeric values can overlap.

| `op` | Request fields beyond `op` | Response |
| --- | --- | --- |
| `processes` | None | Array of `{id, status}` records |
| `classes` | None | Class names, categories, superclasses, slots, class slots, and instance-side and class-side method counts |
| `methods` | Optional `className`, `selector`, `sends` | Current methods with owner, selector, protocol, implementation form, ID, and available source.  `sends` finds bytecode sends, including nested blocks. |
| `inspect` | `processId` | Encoded process state |
| `run`, `resume`, `stepOver`, `stepOut`, `retry` | `processId`, optional `budget` | Encoded process state |
| `step`, `pause` | `processId` | Encoded process state |
| `cancel` | `processId`, optional `budget` | Encoded process state |
| `stopOnSignal` | Boolean `value` | `{stopOnSignal}` |
| `evaluate` | `source`, optional `processId`, `frameId`, or encoded `receiver` | New paused process state |
| `setVariable` | `processId`, `frameId`, `name`, encoded `value`, optional lexical `depth` | Updated process state |
| `setSendOperand` | `processId`, `frameId`, operand `index`, encoded `value` | Updated process state |
| `dispose` | `processId` | `{id, status: 'disposed'}` |
| `install` | `className`, which can name a metaclass such as `Point class`, method `source`, optional `protocol`, `expectedMethodId`, `selector` | Installed method description |
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

Host object inspection reports own string-named properties with encoded values
or accessor descriptions.  It reads property descriptors without invoking
getters.  Host arrays and typed arrays report indexed pages, including absent
elements.  JavaScript proxies can execute their reflection traps.
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

The output is `breakpoint`, followed by `42`.  `method.codes` lists the
method's code and the block's code.  The breakpoint at `pc` 0 stops before the
block's first instruction.

## Embedding and bytecode

### Synchronous JavaScript primitives

`primitive(klass, selector, arity, invoke)` installs a method backed by a
JavaScript function.  The function receives the receiver, an argument array,
and `{processId, scope}`.  Its return value must have a Smallslop class or be
a `HostOperation`.  Supported values include ordinary Smallslop objects,
classes, blocks, `null`, Booleans, strings, BigInts, Numbers, and JavaScript
arrays.  `classOf(value)` returns their runtime class.

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

The result is `144n`.  A primitive that throws signals an `Error` at the
send.  Unhandled, the error suspends the process at the send with its
operands.  A synchronous primitive runs to completion or failure within
one instruction.  Returning a `HostOperation` suspends the process.

### Host values and calls

`new Host(runtime, runner)` installs the host methods once per runtime.
`host.value(value)` preserves strings, Booleans, BigInts, Numbers, and `null`.
It wraps foreign objects, arrays, and functions in `HostObject` values while
preserving their host identity.  `host.unwrap(value)` recovers the original
value.  Host Numbers remain Floats.  Integer conversion uses `asFloat` when
the called API requires a Number.

JavaScript `undefined` has a distinct host wrapper whose `isUndefined` returns
`true`.  Property names use strings.  Host symbols remain unsupported.
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

Host call results pass through the same value conversion.  A thrown host
exception signals an `Error` at the send.  A promise-returning call waits for its result.  A property read
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

The output is `waiting`, followed by `completed 42n`.  `whenReady` resolves
after success, rejection, or cancellation changes the process state.  A
successful call advances past the send.  A rejected call signals an `Error`
at the same send, and the process becomes ready to run the signal.
Unhandled, the error pauses the process at that send with its operands.  `retry` invokes it again, so the
host operation can repeat effects.  Earlier Smallslop instructions keep their
effects.  Stepping stops at the requested point after a call completes.
Pending host work retains its runtime until completion or cancellation, and
cancellation releases that reference even if the host promise remains pending.

A host method or primitive can return `new HostOperation(promise, {cancel: ()
=> controller.abort()})` to support cancellation.  Cancellation invalidates
the wait before invoking the handler and ignores late success or rejection.
Cancellation-handler errors reach the caller after the process becomes
cancelled.  A plain promise supplies no host cancellation handler.  In that
case, cancelling the process prevents resumption while the host work follows
its own lifetime.

### Scheduling and callback ownership

`new ProcessRunner(runtime, {budget: 1000, onChange})` schedules one bounded
interpreter batch per timer task.  `runner.follow(processId)` continues a new
process, a budget stop, or a waiting operation.  It stops automatic execution
at a breakpoint, error, completed step, explicit pause, or process completion.
`onChange(processId)` reports each batch or asynchronous state change.  After
a debugger command, calling `follow` updates scheduling from the resulting
process state.  `runner.forget(id)` removes scheduling for one process.
`runner.close()` stops the runner's scheduled work.

`host.scope()` creates an owner for listeners and processes.
`scope.start(receiver, selector, args)` creates and schedules a process.
`runtime.start` and `runtime.evaluate` also accept `{scope}` in their options.
Frame evaluation inherits its selected process's scope.  A callback block
accepts zero arguments or one wrapped Event argument.  Each event queues a new
process.  Its captured bindings remain shared after the registering method
returns.  Event callbacks execute after dispatch, so synchronous event
cancellation belongs in host code.

`scope.listen(target, type, block)` returns a listener-removal function.
`scope.reap({keep: processId, retain: processIds})` disposes completed or
cancelled processes, except the optional `keep` process and the IDs in the
optional `retain` Set or Map.  `scope.dispose()` removes its listeners,
cancels pending processes, and disposes their records.  It reports cleanup
failures through `AggregateError` after attempting every cleanup.  Debugger
object handles have a separate lifetime and use `release` or `releaseAll`.

### Compiling and assembling code

`compileMethod(klass, source)` returns `{selector, code}` for later
installation with `runtime.install(klass, selector, code)`.
`compileExpression(klass, source)` returns a `Code` object for an evaluated
expression.  A class name compiles to a `global` instruction, which looks the
class up when it runs.

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
| `global` | Literal index of a class name | Push the class registered under that name, or suspend with `UndefinedName` |
| `dup` | None | Push the stack's top value again, for a cascade |

Lexical depth zero denotes the current environment.  Binding indexes start at
zero, with arguments followed by locals.  Greater depths select captured
environments.  A successful send consumes its receiver and arguments.  An
ordinary return supplies one result to the caller's operand stack.

## Browser tools

### Pane workspace

`createWorkspace(options)` in [`ui/workspace.js`](../ui/workspace.js) creates
an area of movable, resizable panes.  Each pane is a Smallslop object whose
methods open, close, focus, move, resize, and enlarge it.  Workspace commands
and pane controls send these messages, so their changes run as Smallslop
processes that the debugger can inspect.  Restoring a saved arrangement, Reset
arrangement, and fitting panes to a resized container set the pane slots in
JavaScript.  The workspace adds a Panes pane that lists and opens panes, an
Activity pane that lists reported errors, and Panes and Reset arrangement
buttons to the toolbar.  It saves the arrangement in the given storage and
restores it on the next load, including the arrangement of panes that `add`
registers later.

| Option | Meaning |
| --- | --- |
| `container` | Element that holds the panes |
| `toolbar` | Element that receives the workspace buttons |
| `definitions` | Pane definitions to register at creation |
| `storage`, `storageKey` | A `Storage` object, such as `localStorage`, and the key for the saved arrangement |
| `onChange` | Function called after pane changes |

The returned object has `world`, `dispatch(request)`, `add(definition)`,
`report(error)`, `state()`, and `dispose()`.  `world` holds the pane runtime,
its host, its debugger adapter, and its panes.  `dispatch` runs a workspace
command, and `add` registers a pane after creation.  `report` records an error
in the Activity pane.

| Definition field | Meaning |
| --- | --- |
| `id` | Unique pane ID of lowercase letters, digits, and hyphens |
| `title`, `description` | Title bar text and the Panes list description |
| `bounds` | Initial `{x, y, width, height}` in pixels |
| `open` | Show the pane at creation |
| `create(body, {pane, report, on})` | Build the pane's content in `body` and return its handlers |
| `className`, `owner`, `association` | Optional pane class, owning object, and `{id, label, color}` group marker |

`create` runs when the pane is first shown.  `on(node, type, handler)` adds an
event listener that the workspace removes with the content.  The returned
object can provide `refresh()`, `state()`, `visibility(shown)`, and
`dispose()`, and `state()` supplies the pane's `content` in the workspace
state.

| Command | Arguments | Effect |
| --- | --- | --- |
| `state` | none | Focused pane and each pane's bounds, visibility, owner, object handle, latest process, and content |
| `open`, `close`, `focus`, `enlarge` | `id` | Send the pane object the message of the same name |
| `move` | `id`, `x`, `y` | Send `moveTo:y:` |
| `resize` | `id`, `width`, `height` | Send `resizeTo:height:` |
| `send` | `id`, `selector`, `args` | Send a message with [encoded arguments](#commands-and-values) |
| `debug` | `request` | Run a [JSON debugger request](#json-debugger-api) in the pane runtime |

### Development panes

`createWorkspaceDevelopment(workspace, {server})` in
[`ui/development.js`](../ui/development.js) adds the System Browser and
Debugger panes to a workspace.  It opens object inspectors and expression
debuggers as further panes.  The optional `server` function sends a command to
a [server runtime](#server-runtime), for example `request =>
connection.server(request)`.  With it, the Debugger and the expression
debuggers of page inspectors can select the Server runtime.  Server object
inspectors receive their own server function from `remoteInspector`.

The returned `execute(request)` runs `browse` and `objectInspector` commands
and passes other commands to the workspace.  `inspect(value)` opens an
inspector on a page value, and `remoteInspector(snapshot, server)` opens one
on a server inspection.  `refresh()` updates the visible development panes,
and `serverDisconnected()` marks every server inspector disconnected after the
server connection closes.

The System Browser selects a category, class, protocol, and method above a
source editor.  It installs edited methods after checking that the loaded
version is still current, searches senders and implementors, shows the class
hierarchy and slots, and sets entry breakpoints.  With a class selected and no
method, the editor holds the class definition, and Accept redefines the class.
New class starts a definition for a subclass of the selected class.  File out
downloads the selected class as `ClassName.st`, and File in reads an
interchange file into the page runtime.  The Class button shows the
class side, the methods of the selected class's metaclass.  Each browser's
selections and draft belong to its Smallslop object.

The Debugger lists the selected runtime's processes and source methods.  It
inspects, pauses, resumes, steps, retries, and cancels a selected process.  It
installs edited method source, sets entry breakpoints, clears breakpoints, and
runs JSON debugger requests typed into its command box.

### Object inspectors

An object inspector lists an object's fields, displays a selected value, and
evaluates source with the inspected object as `self`.  Inspect field and
Inspect result open independent inspectors.  Debug it starts a paused
evaluation, and Debugger opens that process for inspection and repair.

An `Inspector` object owns its receiver, selection, offset, expression, and
evaluation.  Each session owns its debugger handles and processes.  An
attached debugger retains its evaluation after the inspector closes.  Host
records and arrays expose stored values and label accessors.  Collection
inspection reads pages of 100 values and preserves ResultSet position.

For embedding, `new Inspectors(host, debuggerAdapter)` defines the `Inspector`
class and owns inspection sessions.  A runtime can have one `Inspectors`
registry, because a second one would define the class again.  `open(value)`
returns a session with `id`, `object`, and `state()`.
`dispatch({action:'open', value:encodedValue})` decodes through the supplied
debugger adapter and returns session state.  Subsequent actions use that
session ID.  `retain` accepts an optional `processId`, and matching `close`
calls release those references.  `dispose()` releases all sessions.  The
registry uses its host's runtime and runner.

### Counter page

The [counter page](../examples/index.html), served by `npm run serve`, shows
two counters and a shared debugger and method editor.  Each counter is a
Smallslop object with its own DOM root and host scope.  Smallslop methods
register its callbacks, update its count, render its output, and invoke
delayed host work.  The [counter source](../examples/counters.js) contains
those methods and the JavaScript debugger interface.

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
and shows lexical bindings and prepared send operands.  Edits use the [JSON
value format](#commands-and-values).  Run starts ordinary execution.  Resume
preserves a pending step-over or step-out target.  Break here uses the
selected frame's code path and PC.  Break at entry uses the method version
loaded in the editor.  A method breakpoint applies to every invocation of that
version.

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

Reject later pauses with a prepared `call:with:with:` send.  Setting Argument
3 to `{"kind":"boolean","value":false}` and selecting Retry starts a
successful host call.  Cancel during a wait cancels the timer and prevents
resumption.  Cancellation preserves state changes made before the cancelled
operation.  The counting loop updates its stored count during execution and
renders at completion.  Inspecting its Counter receiver reveals the stored
count while it is paused.

The page retains the selected or latest terminal process for each counter and
disposes older terminal records.  Frame evaluations inherit the counter's
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

The output is `completed 2.5`.  The [scripted repair
page](../examples/repair.html) runs the nested-block and missing-method repair
example in the browser.  Its console provides `createRepairDemo`,
`runRepairDemo`, and `runAgentRepairDemo`, from the same [repair
code](../examples/repair.js) that `npm run demo` runs in Node.

## Server runtime

`ServerWorld` in [`server/world.mjs`](../server/world.mjs) is a Smallslop
runtime for Node with a `Database` object.  `new ServerWorld(path)` opens the
SQLite database at `path`, or a private in-memory database for `:memory:`.
SQL runs in a separate process, so the server debugger can respond while a
statement runs.  [Agent and Web Server](agent.md#server-commands) lists the
commands that `dispatch(request, {signal})` accepts.

`Database execute:parameters:` accepts SQL reads, writes, schema changes, and
explicit transactions, one statement per send.  It returns a `ResultSet` with
column metadata, completed rows, the affected-row count, and paging.  Results
stay in server memory until closed.  A failed SQL send pauses with its frames
retained, and the debugger can repair and retry it.

`send(receiver, selector, args, {pause, signal})` starts a process and
resolves when it completes or stops for inspection.  `pause: true` creates the
process paused.  An aborted signal cancels the process.  `close()` cancels
waiting processes and closes the database.  The module also exports
`completed(response)`, a function that returns a command response whose
process completed and throws an error describing any other outcome.

## Unimplemented features

| Area | Pending work |
| --- | --- |
| Interchange format | Class variables, shared pools, indexed instance variables, globals, pools, and initializers |
| Debugger | Source-level stepping and invocation restart |
| Host access | Constructors, module imports, host symbols, and callbacks requiring synchronous return values |
| Persistence | Saved interpreter images, saved object graphs, suspended execution, and host-resource reconstruction.  Components save their source and declared state. |
| Optimization | Profiling and optional per-method JavaScript compilation |
