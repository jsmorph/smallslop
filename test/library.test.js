import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, SmallCharacter, SmallSymbol } from '../src/index.js';

const runtime = new Runtime();

function run(source) {
  const state = runtime.run(runtime.evaluate(source), { budget: 10_000_000 });
  if (state.status !== 'completed') throw state.stop.error ?? new Error(`Process stopped: ${state.stop.reason}.`);
  return state.result;
}

const print = source => run(`(${source}) printString`);

test('integers and fractions mix exactly, and floats need explicit conversion', () => {
  assert.equal(print('3 / 4'), '3/4');
  assert.equal(run('6 / 3'), 2n);
  assert.equal(print('(1 / 3) + (1 / 6)'), '1/2');
  assert.equal(run('(1 / 3) + (2 / 3)'), 1n);
  assert.equal(print('1 - (1 / 3)'), '2/3');
  assert.equal(print('(2 / 3) * 3 / 4'), '1/2');
  assert.equal(print('(-6) / 4'), '-3/2');
  assert.equal(run('(1 / 2) < (2 / 3)'), true);
  assert.equal(run('1 > (1 / 2)'), true);
  assert.equal(run('(1 / 2) = (2 / 4)'), true);
  assert.equal(run('(1 / 2) hash = (2 / 4) hash'), true);
  assert.equal(run('(7 / 2) floor'), 3n);
  assert.equal(run('(-7 / 2) ceiling'), -3n);
  assert.equal(run('(-7 / 2) truncated'), -3n);
  assert.equal(run('(5 / 2) rounded'), 3n);
  assert.equal(run('(-5 / 2) rounded'), -3n);
  assert.equal(run('(1 / 4) asFloat'), 0.25);
  assert.equal(print('0.75 asFraction'), '3/4');
  assert.equal(print('(2 / 3) reciprocal'), '3/2');
  assert.throws(() => run('1 / 0'), error => error.name === 'ZeroDivide');
  assert.throws(() => run('(1 / 2) + 0.5'), /Convert Floats with asFloat/);
  assert.throws(() => run('1 + 0.5'), /Convert Floats with asFloat/);
});

test('the number protocol follows ANSI rounding, division, and powers', () => {
  assert.equal(run('7 // 2'), 3n);
  assert.equal(run('-7 // 2'), -4n);
  assert.equal(run('-7 \\\\ 2'), 1n);
  assert.equal(run('-7 rem: 2'), -1n);
  assert.equal(run('2.5 rounded'), 3n);
  assert.equal(run('-2.5 rounded'), -3n);
  assert.equal(run('-2.5 floor'), -3n);
  assert.equal(run('2.1 ceiling'), 3n);
  assert.equal(run('2.5 asInteger'), 3n);
  assert.equal(run('2 raisedTo: 100'), 2n ** 100n);
  assert.equal(print('2 raisedTo: -2'), '1/4');
  assert.equal(run('2.0 raisedTo: 3'), 8);
  assert.equal(run('2.0 raisedTo: 0.5'), Math.SQRT2);
  assert.equal(run('16 sqrt'), 4);
  assert.equal(run('10 factorial'), 3628800n);
  assert.equal(run('12 gcd: 18'), 6n);
  assert.equal(run('12 lcm: 18'), 36n);
  assert.equal(run('-3 abs'), 3n);
  assert.equal(run('-2.5 sign'), -1n);
  assert.equal(run('0 isZero'), true);
  assert.equal(run('4 even & 5 odd'), true);
  assert.equal(run('5 between: 1 and: 10'), true);
  assert.equal(run('3 max: 9'), 9n);
  assert.equal(run('17 roundTo: 5'), 15n);
  assert.equal(run('(6 bitAnd: 3) + (6 bitOr: 1) + (6 bitXor: 2) + (1 bitShift: 4)'), 2n + 7n + 4n + 16n);
  assert.equal(run('5 bitAt: 1'), 1n);
  assert.equal(run('5 bitAt: 2 put: 1'), 7n);
  assert.equal(run('8 highBit'), 4n);
  assert.equal(run('6 allMask: 2'), true);
  assert.equal(run('255 printStringRadix: 16'), '16rFF');
  assert.equal(run('| s | s := WriteStream on: String new. -255 printOn: s base: 16 showRadix: false. s contents'), '-FF');
  assert.equal(run('2.0 printString'), '2.0');
  assert.equal(run('1.0e21 printString'), '1.0e21');
  assert.equal(run('-0.0 printString'), '-0.0');
  assert.equal(run('100.0 log: 10.0'), 2);
  assert.equal(run('| sum | sum := 0. 1 to: 10 do: [:i | sum := sum + i]. sum'), 55n);
  assert.equal(run('| sum | sum := 0. 10 to: 1 by: -3 do: [:i | sum := sum + i]. sum'), 22n);
  assert.equal(run('| count | count := 0. 3 timesRepeat: [count := count + 1]. count'), 3n);
});

test('strings are immutable sequences of characters', () => {
  assert.equal(run("'hello' size"), 5n);
  assert.equal(run("'hello' at: 1"), SmallCharacter.of(104));
  assert.equal(run("'hello' , ' ' , #world"), 'hello world');
  assert.equal(run("'hello' copyFrom: 2 to: 4"), 'ell');
  assert.equal(run("'hello' reverse"), 'olleh');
  assert.equal(run("'hello' asUppercase"), 'HELLO');
  assert.equal(run("'hello' indexOf: $l"), 3n);
  assert.equal(run("'hello' includes: $z"), false);
  assert.deepEqual(run("'a,b,,c' subStrings: ','"), ['a', 'b', 'c']);
  assert.deepEqual(run("'one two  three' subStrings"), ['one', 'two', 'three']);
  assert.equal(run("'hello world' copyReplaceAll: 'o' with: '0'"), 'hell0 w0rld');
  assert.equal(run("'abc' collect: [:each | each asUppercase]"), 'ABC');
  assert.throws(() => run("'abc' collect: [:each | 1]"), /String stream accepts Characters/);
  assert.equal(run("'abc' select: [:each | each isVowel]"), 'a');
  assert.equal(run("'abc' < 'abd'"), true);
  assert.equal(run("'Hello' sameAs: 'hELLO'"), true);
  assert.equal(run("'abc' = 'abc'"), true);
  assert.equal(run("'abc' = #abc"), false);
  assert.equal(run("'abc' hash = 'abc' copy hash"), true);
  assert.equal(run("String with: $a with: $b"), 'ab');
  assert.equal(run("String new"), '');
  assert.equal(run("'it''s' printString"), "'it''s'");
  assert.equal(run('#at:put: printString'), '#at:put:');
  assert.equal(run("#'two words' printString"), "#'two words'");
  assert.equal(run("'abc' asSymbol"), SmallSymbol.of('abc'));
  assert.throws(() => run("'abc' at: 1 put: $z"), /does not understand at:put:/);
});

test('arrays support ANSI sequenced collection messages', () => {
  assert.deepEqual(run('Array new: 3'), [null, null, null]);
  assert.deepEqual(run('(Array new: 2) at: 1 put: 7; yourself'), [7n, null]);
  assert.throws(() => run('#(1 2) at: 1 put: 3'), /literal array cannot be changed/);
  assert.deepEqual(run('#(1 2) copy at: 1 put: 3; yourself'), [3n, 2n]);
  assert.throws(() => run('#(1 2) at: 3'), /Index 3 is outside 1 through 2/);
  assert.deepEqual(run('Array with: 1 with: 2 with: 3'), [1n, 2n, 3n]);
  assert.deepEqual(run('#(1 2 3) collect: [:each | each * each]'), [1n, 4n, 9n]);
  assert.deepEqual(run('#(1 2 3 4) select: [:each | each even]'), [2n, 4n]);
  assert.deepEqual(run('#(1 2 3 4) reject: [:each | each even]'), [1n, 3n]);
  assert.equal(run('#(1 2 3) inject: 0 into: [:sum :each | sum + each]'), 6n);
  assert.equal(run('#(1 2 3) detect: [:each | each > 1]'), 2n);
  assert.equal(run('#(1 2 3) detect: [:each | each > 5] ifNone: [0]'), 0n);
  assert.deepEqual(run('#(1 2 3) reverse'), [3n, 2n, 1n]);
  assert.deepEqual(run('#(1 2) , #(3)'), [1n, 2n, 3n]);
  assert.deepEqual(run('#(1 2) copyWith: 3'), [1n, 2n, 3n]);
  assert.deepEqual(run('#(1 2 1) copyWithout: 1'), [2n]);
  assert.deepEqual(run('#(1 2 3 4 5) copyReplaceFrom: 2 to: 3 with: #(9)'), [1n, 9n, 4n, 5n]);
  assert.equal(run('#(1 2 3) indexOf: 3'), 3n);
  assert.equal(run('#(1 2 3) = #(1 2 3)'), true);
  assert.equal(run('#(1 2 3) = #(1 2)'), false);
  assert.equal(run('#(1 2 3) allSatisfy: [:each | each > 0]'), true);
  assert.equal(run('#(1 2 3) anySatisfy: [:each | each > 2]'), true);
  assert.equal(run('#(1 2 3) after: 2'), 3n);
  assert.equal(run('#(1 2 3) last'), 3n);
  assert.throws(() => run('#() first'), /The collection is empty/);
  assert.equal(run("| s | s := WriteStream on: String new. #(1 2 3) do: [:each | s print: each] separatedBy: [s nextPutAll: ', ']. s contents"), '1, 2, 3');
  assert.equal(print("#(1 $a 'b' #c #(2) nil)"), "#(1 $a 'b' #c #(2) nil)");
});

test('ordered and sorted collections grow and keep order', () => {
  assert.equal(print('OrderedCollection new add: 1; add: 2; addFirst: 0; yourself'), 'an OrderedCollection(0 1 2)');
  assert.equal(run('| c | c := OrderedCollection withAll: #(1 2 3). c removeFirst + c removeLast'), 4n);
  assert.equal(print('(OrderedCollection withAll: #(1 3)) add: 2 beforeIndex: 2; yourself'), 'an OrderedCollection(1 2 3)');
  assert.equal(print('(OrderedCollection withAll: #(1 3)) add: 2 after: 1; yourself'), 'an OrderedCollection(1 2 3)');
  assert.equal(print('(OrderedCollection withAll: #(1 2 3)) remove: 2; yourself'), 'an OrderedCollection(1 3)');
  assert.equal(run('(OrderedCollection withAll: #(1 2 3)) remove: 9 ifAbsent: [#missing]'), SmallSymbol.of('missing'));
  assert.equal(run('| a b | a := OrderedCollection withAll: #(1 2). b := a copy. b add: 3. a size'), 2n);
  assert.throws(() => run('OrderedCollection new removeFirst'), error => error.name === 'EmptyCollection');
  assert.equal(print('#(3 1 2) asSortedCollection'), 'a SortedCollection(1 2 3)');
  assert.equal(print('(#(3 1 2) asSortedCollection: [:a :b | a > b]) add: 5; yourself'), 'a SortedCollection(5 3 2 1)');
  assert.equal(print('#(5 1 4 2) asSortedCollection select: [:each | each > 1]'), 'a SortedCollection(2 4 5)');
  assert.throws(() => run('SortedCollection new addFirst: 1'), /not appropriate/);
  assert.equal(print('(SortedCollection sortBlock: [:a :b | a size <= b size]) add: \'ccc\'; add: \'a\'; add: \'bb\'; yourself'),
    "a SortedCollection('a' 'bb' 'ccc')");
});

test('intervals enumerate arithmetic progressions', () => {
  assert.equal(run('(1 to: 10) size'), 10n);
  assert.equal(run('(1 to: 0) size'), 0n);
  assert.deepEqual(run('(1 to: 10 by: 3) asArray'), [1n, 4n, 7n, 10n]);
  assert.deepEqual(run('(10 to: 1 by: -4) asArray'), [10n, 6n, 2n]);
  assert.deepEqual(run('(1 to: 4) collect: [:each | each * 2]'), [2n, 4n, 6n, 8n]);
  assert.deepEqual(run('(1 to: 3) reverse'), [3n, 2n, 1n]);
  assert.equal(run('(1 to: 5) at: 3'), 3n);
  assert.deepEqual(run('(0.0 to: 1.0 by: 0.5) asArray'), [0, 0.5, 1]);
  assert.equal(print('1 to: 9 by: 2'), '(1 to: 9 by: 2)');
  assert.throws(() => run('1 to: 5 by: 0'), /step must not be zero/);
});

test('sets, bags, and dictionaries use = and hash, and identity collections use ==', () => {
  const point = runtime.defineClass('LibraryPoint', { slots: ['x', 'y'] });
  runtime.installSource(point.metaclass, 'x: newX y: newY ^self new setX: newX y: newY');
  runtime.installSource(point, 'setX: newX y: newY x := newX. y := newY');
  runtime.installSource(point, 'x ^x');
  runtime.installSource(point, 'y ^y');
  runtime.installSource(point, '= other ^(other isKindOf: LibraryPoint) and: [x = other x and: [y = other y]]');
  runtime.installSource(point, 'hash ^x hash bitXor: y hash');
  assert.equal(run('(Set withAll: #(1 2 2 3)) size'), 3n);
  assert.equal(run('(Set withAll: #(1 2 3)) remove: 2; includes: 2'), false);
  assert.equal(run('(Set new add: (LibraryPoint x: 1 y: 2); add: (LibraryPoint x: 1 y: 2); yourself) size'), 1n);
  assert.equal(run('(Set withAll: #(1 2 3)) collect: [:each | each \\\\ 2]').klass, runtime.classes.get('Set'));
  assert.equal(run('(Bag withAll: #(1 1 2)) occurrencesOf: 1'), 2n);
  assert.equal(run('(Bag withAll: #(1 1 2)) size'), 3n);
  assert.equal(run('| d | d := Dictionary new. d at: #a put: 1; at: #b put: 2. (d at: #a) + (d at: #b)'), 3n);
  assert.equal(run('Dictionary new at: #missing ifAbsent: [0]'), 0n);
  assert.throws(() => run('Dictionary new at: #missing'), /Key not found: #missing/);
  assert.equal(run('| d | d := Dictionary new. d at: 1 put: 2. d at: 1 put: 3. d size + (d at: 1)'), 4n);
  assert.equal(run('| d | d := Dictionary new. 1 to: 200 do: [:i | d at: i put: i * i]. (d at: 150) + d size'), 22700n);
  assert.equal(run('| d | d := Dictionary new. d at: (LibraryPoint x: 1 y: 2) put: #found. d at: (LibraryPoint x: 1 y: 2)'), SmallSymbol.of('found'));
  assert.equal(run('| d | d := IdentityDictionary new. d at: (LibraryPoint x: 1 y: 2) put: #found. d at: (LibraryPoint x: 1 y: 2) ifAbsent: [#absent]'), SmallSymbol.of('absent'));
  assert.equal(run('| d | d := Dictionary new. d at: #a put: 1. d removeKey: #a. d isEmpty'), true);
  assert.equal(run('| d | d := Dictionary new. d at: #a put: 1. d keyAtValue: 1'), SmallSymbol.of('a'));
  assert.equal(run('| d | d := Dictionary new. d at: #a put: 1; at: #b put: 2. d keys size'), 2n);
  assert.deepEqual(run('| d | d := Dictionary new. d at: #a put: 1. d values'), [1n]);
  assert.equal(run('| d | d := Dictionary new. d at: #a put: 1; at: #b put: 2. ((d collect: [:each | each * 10]) at: #b)'), 20n);
  assert.equal(run('| d | d := Dictionary new. d at: #a put: 1; at: #b put: 2. (d select: [:each | each > 1]) keys size'), 1n);
  assert.equal(run('| d | d := Dictionary new. d at: #a ifAbsentPut: [5]. d at: #a ifAbsentPut: [6]'), 5n);
  assert.equal(print('Dictionary new at: #a put: 1; yourself'), 'Dictionary(#a->1)');
});

test('read and write streams follow the ANSI stream protocols', () => {
  assert.equal(run("(ReadStream on: 'hello world') upTo: $ "), 'hello');
  assert.equal(run("| s | s := ReadStream on: 'abc'. s next. s peek"), SmallCharacter.of(98));
  assert.equal(run("| s | s := ReadStream on: 'abc'. s skip: 2. s next"), SmallCharacter.of(99));
  assert.equal(run("| s | s := ReadStream on: 'abc'. s upToEnd. s atEnd"), true);
  assert.throws(() => run("| s | s := ReadStream on: ''. s next"), /at its end/);
  assert.equal(run("| s | s := ReadStream on: 'one' , (String with: Character cr with: Character lf) , 'two'. s nextLine"), 'one');
  assert.deepEqual(run('(ReadStream on: #(1 2 3 4)) next: 2'), [1n, 2n]);
  assert.equal(run("| s | s := WriteStream on: String new. s nextPutAll: 'a'; nextPut: $b; print: 3; space; nextPutAll: #c. s contents"), 'ab3 c');
  assert.equal(run("(WriteStream with: 'abc') nextPutAll: 'def'; contents"), 'abcdef');
  assert.equal(run("(WriteStream on: 'abc') nextPutAll: 'def'; contents"), 'def');
  assert.deepEqual(run('(WriteStream on: Array new) nextPut: 1; nextPutAll: #(2 3); contents'), [1n, 2n, 3n]);
  assert.equal(run("| s | s := WriteStream on: String new. s cr. s contents"), '\n');
  assert.throws(() => run("(WriteStream on: String new) nextPut: 'text'"), /String stream accepts Characters/);
});

test('printString, Boolean logic, and block messages', () => {
  assert.equal(run('Object new printString'), 'an Object');
  assert.equal(run('3 printString'), '3');
  assert.equal(run('$a printString'), '$a');
  assert.equal(run('nil printString'), 'nil');
  assert.equal(run('true printString'), 'true');
  assert.equal(run('Object printString'), 'Object');
  assert.equal(run('Object class printString'), 'Object class');
  assert.equal(run('(1 -> 2) printString'), '1->2');
  assert.equal(run('(Set with: 1) printString'), 'a Set(1)');
  assert.equal(run('true & false | true'), true);
  assert.equal(run('true xor: true'), false);
  assert.equal(run('false eqv: false'), true);
  assert.equal(run('[:a :b | a + b] valueWithArguments: #(1 2)'), 3n);
  assert.equal(run('[:a :b | a] argumentCount'), 2n);
  assert.throws(() => run('[:a | a] valueWithArguments: #(1 2)'), /takes 1 arguments, not 2/);
  assert.equal(run('| n | n := 0. [n := n + 1. n < 5] whileTrue. n'), 5n);
  assert.equal(run('3 isNumber & 3 isInteger & $a isCharacter & #a isSymbol & #a isString & #() isArray'), true);
});
