import test from 'node:test';
import assert from 'node:assert/strict';
import { Debugger, Host, ProcessRunner, Runtime, SmallCharacter, SmallSymbol } from '../src/index.js';
import { decode, encode } from '../components/values.js';
import { encode as sqlEncode, parameters } from '../server/values.js';
import { readPackageSync } from '../server/source-files.mjs';

const kernel = readPackageSync('kernel');

function run(runtime, source) {
  const state = runtime.run(runtime.evaluate(source));
  if (state.status !== 'completed') throw state.stop.error ?? new Error(`Process stopped: ${state.stop.reason}.`);
  return state.result;
}

test('class names resolve when code runs, so an undefined class can be repaired', () => {
  const runtime = new Runtime({ sources: kernel });
  const processId = runtime.evaluate('Later new isKindOf: Later');
  const paused = runtime.run(processId);
  assert.equal(paused.stop.error.name, 'UndefinedName');
  assert.equal(paused.stop.error.variable, 'Later');
  runtime.defineClass('Later');
  assert.equal(runtime.retry(processId).result, true);
  assert.throws(() => runtime.evaluate('later'), /Unknown name later/);
});

test('the Object protocol covers identity, copying, hashing, testing, and perform', () => {
  const runtime = new Runtime({ sources: kernel });
  const point = runtime.defineClass('Point', { slots: ['x', 'y'] });
  runtime.installSource(point, 'x: newX x := newX');
  runtime.installSource(point, 'x ^x');
  assert.equal(run(runtime, '| p q | p := Point new x: 3. q := p copy. q x: 4. p x'), 3n);
  assert.equal(run(runtime, '| p | p := Point new. p copy ~~ p'), true);
  assert.equal(run(runtime, '| p | p := Point new. p hash = p identityHash'), true);
  assert.equal(run(runtime, "'text' hash = 'text' copy hash"), true);
  assert.equal(run(runtime, '0.0 hash = -0.0 hash'), true);
  assert.equal(run(runtime, 'Point new isKindOf: Object'), true);
  assert.equal(run(runtime, 'Point new isMemberOf: Object'), false);
  assert.equal(run(runtime, "Point new respondsTo: 'x:'"), true);
  assert.equal(run(runtime, "3 perform: '+' with: 4"), 7n);
  assert.equal(run(runtime, "(Point new perform: 'x:' with: 5) x"), 5n);
  runtime.defineClass('Single', { slots: ['value'] });
  assert.equal(run(runtime, "(Point new perform: 'x:' withArguments: Single instVarNames) x"), 'value');
  assert.throws(() => run(runtime, "3 perform: 'negated' withArguments: Point allInstVarNames"), /negated expects 0 arguments/);
});

test('perform reports a missing method at the perform send, and retry repeats it', () => {
  const runtime = new Runtime({ sources: kernel });
  const klass = runtime.defineClass('Greeter');
  const processId = runtime.evaluate("Greeter new perform: 'greet'");
  const paused = runtime.run(processId);
  assert.equal(paused.stop.error.name, 'MessageNotUnderstood');
  assert.equal(paused.stop.error.selector, 'greet');
  assert.equal(paused.frames[0].pendingSend.selector, 'perform:');
  runtime.installSource(klass, "greet ^'hello'");
  assert.equal(runtime.retry(processId).result, 'hello');
  assert.throws(() => run(runtime, "Greeter new perform: 'greet' with: 1"), /greet expects 0 arguments/);
  assert.throws(() => run(runtime, 'Greeter new perform: 3'), /selector must be a nonempty Symbol or String/);
  assert.throws(() => run(runtime, "nil error: 'Stopped here.'"), /Stopped here/);
});

test('classes describe their names, hierarchy, variables, and methods', () => {
  const runtime = new Runtime({ sources: kernel });
  const shape = runtime.defineClass('Shape', { slots: ['origin'], category: 'Graphics' });
  const circle = runtime.defineClass('Circle', { superclass: shape, slots: ['radius'], category: 'Graphics' });
  runtime.installSource(circle, 'radius ^radius');
  assert.equal(run(runtime, 'Circle name'), 'Circle');
  assert.equal(run(runtime, 'Circle category'), 'Graphics');
  assert.equal(run(runtime, 'Circle superclass'), shape);
  assert.deepEqual(run(runtime, 'Shape subclasses'), [circle]);
  assert.deepEqual(run(runtime, 'Shape allSubclasses'), [circle]);
  assert.deepEqual(run(runtime, 'Circle allSuperclasses'), [shape, runtime.classes.get('Object')]);
  assert.deepEqual(run(runtime, 'Circle instVarNames'), ['radius']);
  assert.deepEqual(run(runtime, 'Circle allInstVarNames'), ['origin', 'radius']);
  assert.deepEqual(run(runtime, 'Circle selectors'), [SmallSymbol.of('radius')]);
  assert.equal(run(runtime, "Circle includesSelector: 'radius'"), true);
  assert.equal(run(runtime, "Circle canUnderstand: 'isNil'"), true);
  assert.equal(run(runtime, 'Circle inheritsFrom: Shape'), true);
  assert.equal(run(runtime, 'Shape inheritsFrom: Shape'), false);
});

test('symbols and characters are interned literal objects', () => {
  const runtime = new Runtime({ sources: kernel });
  const symbol = run(runtime, '#at:put:');
  assert.equal(symbol, SmallSymbol.of('at:put:'));
  assert.equal(run(runtime, '#foo == #foo'), true);
  assert.equal(run(runtime, "#foo = 'foo'"), false);
  assert.equal(run(runtime, "'foo' asSymbol == #foo"), true);
  assert.equal(run(runtime, '#foo asString'), 'foo');
  assert.equal(run(runtime, "#'two words'"), SmallSymbol.of('two words'));
  assert.equal(run(runtime, '#at:put: numArgs'), 2n);
  assert.equal(run(runtime, '#+ numArgs'), 1n);
  assert.equal(run(runtime, '#size numArgs'), 0n);
  assert.equal(run(runtime, '#foo class'), runtime.classes.get('Symbol'));
  assert.equal(run(runtime, '#foo class superclass'), runtime.classes.get('String'));
  assert.equal(run(runtime, '$a'), SmallCharacter.of(97));
  assert.equal(run(runtime, '97 asCharacter == $a'), true);
  assert.equal(run(runtime, '$a asUppercase'), SmallCharacter.of(65));
  assert.equal(run(runtime, '$1 isDigit and: [$a isLetter]'), true);
  assert.equal(run(runtime, '$  isSeparator'), true);
  assert.equal(run(runtime, '$a codePoint'), 97n);
});

test('literal arrays are frozen and accept only literals, nil, true, and false', () => {
  const runtime = new Runtime({ sources: kernel });
  const array = run(runtime, "#(1 -2 2.5 'text' #sym $c #(3) nil true false)");
  assert.deepEqual(array, [1n, -2n, 2.5, 'text', SmallSymbol.of('sym'), SmallCharacter.of(99), [3n], null, true, false]);
  assert.equal(Object.isFrozen(array), true);
  assert.equal(Object.isFrozen(array[6]), true);
  assert.throws(() => runtime.evaluate('#(foo)'), /literal array element/);
  assert.throws(() => runtime.evaluate('#(1'), /Unterminated literal array/);
});

test('radix integers and ANSI exponent letters are numbers', () => {
  const runtime = new Runtime({ sources: kernel });
  assert.equal(run(runtime, '16r1F'), 31n);
  assert.equal(run(runtime, '-2r1010'), -10n);
  assert.equal(run(runtime, '36rZ'), 35n);
  assert.equal(run(runtime, '1.5d2'), 150);
  assert.equal(run(runtime, '2.5q-1'), 0.25);
  assert.throws(() => runtime.evaluate('2r102'), /Digit 2 is not valid in radix 2/);
  assert.throws(() => runtime.evaluate('37r1'), /radix must be from 2 through 36/);
});

test('cascades send each message to the receiver of the first message', () => {
  const runtime = new Runtime({ sources: kernel });
  const counter = runtime.defineClass('Counter', { slots: ['count'] });
  runtime.installSource(counter, 'increment count isNil ifTrue: [count := 0]. count := count + 1');
  runtime.installSource(counter, 'count ^count');
  assert.equal(run(runtime, 'Counter new increment; increment; count'), 2n);
  assert.equal(run(runtime, '3 + 4; * 10'), 30n);
  assert.equal(run(runtime, '| c | c := Counter new. c increment increment; count'), 2n, 'the cascade receiver is c increment');
  const base = runtime.defineClass('Base');
  const derived = runtime.defineClass('Derived', { superclass: base, slots: ['log'] });
  runtime.installSource(base, "name ^'base'");
  runtime.installSource(derived, "name ^'derived'");
  runtime.installSource(derived, 'both ^super name; name');
  assert.equal(run(runtime, 'Derived new both'), 'base');
  assert.throws(() => runtime.evaluate('3; foo'), /cascade needs a message/);
  assert.throws(() => runtime.evaluate('3 foo;'), /Expected a message after ;/);
});

test('symbols and characters cross the debugger, component, SQL, and host boundaries', () => {
  const runtime = new Runtime({ sources: kernel });
  const debugger_ = new Debugger(runtime);
  assert.deepEqual(debugger_.value(SmallSymbol.of('foo')), { kind: 'symbol', value: 'foo' });
  assert.deepEqual(debugger_.value(SmallCharacter.of(97)), { kind: 'character', value: 97 });
  assert.equal(debugger_.decode({ kind: 'symbol', value: 'foo' }), SmallSymbol.of('foo'));
  assert.equal(debugger_.decode({ kind: 'character', value: 97 }), SmallCharacter.of(97));
  const encoded = encode([SmallSymbol.of('x'), SmallCharacter.of(0x1f600)]);
  assert.deepEqual(decode(JSON.parse(JSON.stringify(encoded))), [SmallSymbol.of('x'), SmallCharacter.of(0x1f600)]);
  assert.deepEqual(parameters([SmallSymbol.of('x'), { kind: 'character', value: 98 }]), ['x', 'b']);
  assert.deepEqual(sqlEncode([SmallSymbol.of('x')]), [{ kind: 'symbol', value: 'x' }]);
  const runner = new ProcessRunner(runtime);
  const host = new Host(runtime, runner);
  const target = host.value({ joined: (a, b) => `${a}${b}` });
  const processId = runtime.start(target, 'call:with:with:', [SmallSymbol.of('joined'), SmallSymbol.of('a'), SmallCharacter.of(98)]);
  assert.equal(runtime.run(processId).result, 'ab');
  runner.close();
});

test('each class has a metaclass that holds its class-side methods and variables', () => {
  const runtime = new Runtime({ sources: kernel });
  const point = runtime.defineClass('Point', { slots: ['x', 'y'], classSlots: ['created'] });
  runtime.installSource(point, 'setX: newX y: newY x := newX. y := newY');
  runtime.installSource(point, 'x ^x');
  runtime.installSource(point.metaclass, 'x: newX y: newY created := (created isNil ifTrue: [0] ifFalse: [created]) + 1. ^self new setX: newX y: newY');
  runtime.installSource(point.metaclass, 'created ^created');
  assert.equal(run(runtime, '(Point x: 3 y: 4) x'), 3n);
  assert.equal(run(runtime, 'Point x: 1 y: 2. Point x: 1 y: 2. Point created'), 3n);
  const point3 = runtime.defineClass('Point3', { superclass: point, slots: ['z'] });
  runtime.installSource(point3.metaclass, 'x: newX y: newY ^(super x: newX y: newY) setZ');
  runtime.installSource(point3, 'setZ z := 0');
  runtime.installSource(point3, 'z ^z');
  assert.equal(run(runtime, '(Point3 x: 5 y: 6) z'), 0n);
  assert.equal(run(runtime, 'Point3 created'), 1n, 'class instance variables belong to each class');
  assert.equal(run(runtime, 'Point created'), 3n);
  assert.equal(run(runtime, 'Point class'), point.metaclass);
  assert.equal(run(runtime, 'Point class name'), 'Point class');
  assert.equal(run(runtime, 'Point class soleInstance'), point);
  assert.equal(run(runtime, 'Point class class == Metaclass'), true);
  assert.equal(run(runtime, 'Metaclass class class == Metaclass'), true);
  assert.equal(run(runtime, 'Point3 class superclass == Point class'), true);
  assert.equal(run(runtime, 'Object class superclass == Class'), true);
  assert.deepEqual(run(runtime, 'Point class subclasses'), [point3.metaclass]);
  assert.throws(() => run(runtime, 'Point class new'), /Point class has one instance, Point/);
  assert.equal(run(runtime, '(Character codePoint: 65) == $A'), true);
  assert.equal(run(runtime, 'Character space == $ '), true);
  assert.equal(run(runtime, 'Character tab codePoint'), 9n);
  const debugger_ = new Debugger(runtime);
  const installed = debugger_.dispatch({ op: 'install', className: 'Point class', source: 'origin ^self x: 0 y: 0' });
  assert.equal(installed.className, 'Point class');
  assert.deepEqual(debugger_.dispatch({ op: 'methods', className: 'Point class' }).map(method => method.selector), ['created', 'origin', 'x:y:']);
  assert.equal(debugger_.dispatch({ op: 'classes' }).find(item => item.name === 'Point').classMethodCount, 3);
});
