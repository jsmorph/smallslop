import { BlockCall, SendCall, SmallCharacter, SmallObject, SmallSymbol } from './objects.js';

function fail(message, name = 'Error', details = {}) {
  throw Object.assign(new Error(message), { name }, details);
}

function index(value, size) {
  if (typeof value !== 'bigint') fail('An index must be an Integer.');
  if (value < 1n || value > BigInt(size)) fail(`Index ${value} is outside 1 through ${size}.`);
  return Number(value) - 1;
}

function text(value, message) {
  if (typeof value === 'string') return value;
  if (value instanceof SmallSymbol) return value.name;
  fail(message);
}

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function floorDivide(a, b) {
  const quotient = a / b;
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? quotient - 1n : quotient;
}

function floorModulo(a, b) {
  const remainder = a % b;
  return remainder !== 0n && (remainder < 0n) !== (b < 0n) ? remainder + b : remainder;
}

export function printFloat(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  if (Object.is(value, -0)) return '-0.0';
  const [mantissa, exponent] = String(value).split('e');
  const decimal = mantissa.includes('.') ? mantissa : `${mantissa}.0`;
  return exponent === undefined ? decimal : `${decimal}e${Number(exponent)}`;
}

export function installPrimitives(runtime) {
  const get = name => runtime.classes.get(name);
  const define = (owner, selector, arity, invoke, protocol) => runtime.primitive(owner, selector, arity, invoke, { protocol });
  const fractionClass = get('Fraction');
  const isFraction = value => value instanceof SmallObject && value.klass === fractionClass;
  const fraction = (numerator, denominator) => {
    if (denominator === 0n) fail('Division by zero.', 'ZeroDivide', { dividend: numerator });
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    if (denominator === 1n) return numerator;
    const result = runtime.newObject(fractionClass);
    Object.assign(result.slots, { numerator, denominator });
    return result;
  };
  const asFraction = integer => {
    const result = runtime.newObject(fractionClass);
    Object.assign(result.slots, { numerator: integer, denominator: 1n });
    return result;
  };

  const integer = get('Integer');
  const exact = (selector, operation, protocol) => define(integer, selector, 1, (receiver, [argument]) => {
    if (typeof argument === 'bigint') return operation(receiver, argument);
    if (isFraction(argument)) return new SendCall(asFraction(receiver), selector, [argument]);
    fail(`Integer ${selector} requires an Integer or Fraction. Convert Floats with asFloat.`);
  }, protocol);
  for (const [selector, operation] of [['+', (a, b) => a + b], ['-', (a, b) => a - b], ['*', (a, b) => a * b]]) exact(selector, operation, 'arithmetic');
  for (const [selector, operation] of [['<', (a, b) => a < b], ['<=', (a, b) => a <= b], ['>', (a, b) => a > b], ['>=', (a, b) => a >= b]]) exact(selector, operation, 'comparing');
  exact('/', (a, b) => fraction(a, b), 'arithmetic');
  exact('//', (a, b) => b === 0n ? fail('Division by zero.', 'ZeroDivide', { dividend: a }) : floorDivide(a, b), 'arithmetic');
  exact('\\\\', (a, b) => b === 0n ? fail('Division by zero.', 'ZeroDivide', { dividend: a }) : floorModulo(a, b), 'arithmetic');
  const integers = (selector, operation, protocol) => define(integer, selector, 1, (receiver, [argument]) => {
    if (typeof argument !== 'bigint') fail(`Integer ${selector} requires an Integer.`);
    return operation(receiver, argument);
  }, protocol);
  integers('quo:', (a, b) => b === 0n ? fail('Division by zero.', 'ZeroDivide', { dividend: a }) : a / b, 'arithmetic');
  integers('rem:', (a, b) => b === 0n ? fail('Division by zero.', 'ZeroDivide', { dividend: a }) : a % b, 'arithmetic');
  integers('gcd:', gcd, 'arithmetic');
  integers('bitAnd:', (a, b) => a & b, 'bit manipulation');
  integers('bitOr:', (a, b) => a | b, 'bit manipulation');
  integers('bitXor:', (a, b) => a ^ b, 'bit manipulation');
  integers('bitShift:', (a, b) => b >= 0n ? a << b : a >> -b, 'bit manipulation');
  integers('bitAt:', (a, b) => b < 1n ? fail('Bit indexes start at 1.') : (a >> (b - 1n)) & 1n, 'bit manipulation');
  define(integer, 'highBit', 0, receiver => receiver < 0n ? fail('highBit requires a nonnegative Integer.') : BigInt(receiver.toString(2).length - (receiver === 0n ? 1 : 0)), 'bit manipulation');
  define(integer, 'printString', 0, receiver => receiver.toString(), 'printing');
  integers('printStringRadix:', (a, radix) => radix < 2n || radix > 36n ? fail('A radix must be from 2 through 36.')
    : `${a < 0n ? '-' : ''}${radix}r${(a < 0n ? -a : a).toString(Number(radix)).toUpperCase()}`, 'printing');
  define(integer, 'sqrt', 0, receiver => Math.sqrt(Number(receiver)), 'mathematical functions');
  define(integer, 'numerator', 0, receiver => receiver, 'accessing');
  define(integer, 'denominator', 0, () => 1n, 'accessing');

  define(fractionClass.metaclass, 'numerator:denominator:', 2, (_receiver, [numerator, denominator]) => {
    if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') fail('A Fraction needs an Integer numerator and denominator.');
    return fraction(numerator, denominator);
  }, 'instance creation');

  const float = get('Float');
  const unaryFloat = (selector, operation, protocol = 'mathematical functions') => define(float, selector, 0, operation, protocol);
  const integral = (value, selector) => Number.isFinite(value) ? BigInt(value) : fail(`${selector} requires a finite Float.`);
  unaryFloat('floor', receiver => integral(Math.floor(receiver), 'floor'), 'truncation and rounding');
  unaryFloat('ceiling', receiver => integral(Math.ceil(receiver), 'ceiling'), 'truncation and rounding');
  unaryFloat('rounded', receiver => integral(Math.sign(receiver) * Math.floor(Math.abs(receiver) + 0.5), 'rounded'), 'truncation and rounding');
  unaryFloat('fractionPart', receiver => receiver - Math.trunc(receiver), 'truncation and rounding');
  unaryFloat('integerPart', receiver => Math.trunc(receiver), 'truncation and rounding');
  for (const [selector, operation] of Object.entries({ sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, sin: Math.sin, cos: Math.cos,
    tan: Math.tan, arcSin: Math.asin, arcCos: Math.acos, arcTan: Math.atan })) unaryFloat(selector, receiver => operation(receiver));
  unaryFloat('degreesToRadians', receiver => receiver * Math.PI / 180);
  unaryFloat('radiansToDegrees', receiver => receiver * 180 / Math.PI);
  unaryFloat('printString', receiver => printFloat(receiver), 'printing');
  unaryFloat('asString', receiver => printFloat(receiver), 'converting');
  unaryFloat('isNaN', receiver => Number.isNaN(receiver), 'testing');
  unaryFloat('asFraction', receiver => {
    if (!Number.isFinite(receiver)) fail('asFraction requires a finite Float.');
    let value = receiver;
    let denominator = 1n;
    while (!Number.isInteger(value)) { value *= 2; denominator *= 2n; }
    return fraction(BigInt(value), denominator);
  }, 'converting');
  define(float, 'log:', 1, (receiver, [base]) => typeof base === 'number' ? Math.log(receiver) / Math.log(base)
    : fail('log: requires a Float base. Convert with asFloat.'), 'mathematical functions');
  define(float, 'raisedTo:', 1, (receiver, [power]) => typeof power === 'number' ? receiver ** power
    : typeof power === 'bigint' ? new SendCall(receiver, 'raisedToInteger:', [power])
      : fail('Float raisedTo: requires a Float or Integer exponent.'), 'mathematical functions');

  const array = get('Array');
  define(array, 'size', 0, receiver => BigInt(receiver.length), 'accessing');
  define(array, 'at:', 1, (receiver, [position]) => receiver[index(position, receiver.length)], 'accessing');
  define(array, 'at:put:', 2, (receiver, [position, value]) => {
    if (Object.isFrozen(receiver)) fail('A literal array cannot be changed. Send copy to get a changeable array.');
    receiver[index(position, receiver.length)] = value;
    return value;
  }, 'accessing');
  define(array.metaclass, 'new:', 1, (_receiver, [size]) => {
    if (typeof size !== 'bigint' || size < 0n) fail('Array new: requires a nonnegative Integer.');
    return Array.from({ length: Number(size) }, () => null);
  }, 'instance creation');
  define(array.metaclass, 'new', 0, () => [], 'instance creation');

  const string = get('String');
  const stringArgument = (value, selector) => text(value, `String ${selector} requires a String or Symbol.`);
  define(string, 'size', 0, receiver => BigInt(text(receiver).length), 'accessing');
  define(string, 'at:', 1, (receiver, [position]) => {
    const value = text(receiver);
    return SmallCharacter.of(value.charCodeAt(index(position, value.length)));
  }, 'accessing');
  define(string, ',', 1, (receiver, [other]) => text(receiver) + stringArgument(other, ','), 'copying');
  define(string, 'copyFrom:to:', 2, (receiver, [start, stop]) => {
    const value = text(receiver);
    if (typeof start !== 'bigint' || typeof stop !== 'bigint') fail('copyFrom:to: requires Integer indexes.');
    if (stop < start) return '';
    return value.slice(index(start, value.length), index(stop, value.length) + 1);
  }, 'copying');
  for (const [selector, operation] of [['<', (a, b) => a < b], ['<=', (a, b) => a <= b], ['>', (a, b) => a > b], ['>=', (a, b) => a >= b]]) {
    define(string, selector, 1, (receiver, [other]) => operation(text(receiver), stringArgument(other, selector)), 'comparing');
  }
  define(string, 'sameAs:', 1, (receiver, [other]) => text(receiver).toLowerCase() === stringArgument(other, 'sameAs:').toLowerCase(), 'comparing');
  define(string, 'asUppercase', 0, receiver => text(receiver).toUpperCase(), 'converting');
  define(string, 'asLowercase', 0, receiver => text(receiver).toLowerCase(), 'converting');
  define(string, 'reverse', 0, receiver => [...text(receiver)].reverse().join(''), 'copying');
  define(string, 'subStrings:', 1, (receiver, [separators]) => {
    const set = new Set(Array.isArray(separators) ? separators.map(item => item instanceof SmallCharacter ? item.text : fail('subStrings: separators must be Characters.'))
      : [...stringArgument(separators, 'subStrings:')]);
    const parts = [];
    let current = '';
    for (const character of text(receiver)) {
      if (set.has(character)) { if (current) parts.push(current); current = ''; } else current += character;
    }
    if (current) parts.push(current);
    return parts;
  }, 'converting');
  define(string, 'indexOf:', 1, (receiver, [character]) => character instanceof SmallCharacter ? BigInt(text(receiver).indexOf(character.text) + 1) : 0n, 'accessing');
  define(string, 'hash', 0, receiver => runtime.identityHash(text(receiver)), 'comparing');
  define(string, '=', 1, (receiver, [other]) => receiver === other, 'comparing');
  define(string, 'printString', 0, receiver => receiver instanceof SmallSymbol
    ? (/^(?:[A-Za-z_][A-Za-z_0-9]*:?)+$|^[+*/\\~<>=@%&,?!|-]+$/.test(receiver.name) ? `#${receiver.name}` : `#'${receiver.name.replaceAll("'", "''")}'`)
    : `'${receiver.replaceAll("'", "''")}'`, 'printing');
  define(string.metaclass, 'new', 0, () => '', 'instance creation');
  define(string.metaclass, 'new:', 1, (_receiver, [size]) => typeof size === 'bigint' && size >= 0n ? ' '.repeat(Number(size))
    : fail('String new: requires a nonnegative Integer.'), 'instance creation');
  define(get('Symbol').metaclass, 'new', 0, () => fail('Create a Symbol with a literal or asSymbol.'), 'instance creation');

  const character = get('Character');
  for (const [selector, operation] of [['<', (a, b) => a < b], ['<=', (a, b) => a <= b], ['>', (a, b) => a > b], ['>=', (a, b) => a >= b]]) {
    define(character, selector, 1, (receiver, [other]) => other instanceof SmallCharacter ? operation(receiver.codePoint, other.codePoint)
      : fail(`Character ${selector} requires a Character.`), 'comparing');
  }
  define(character, 'printString', 0, receiver => `$${receiver.text}`, 'printing');

  const ordered = get('OrderedCollection');
  const items = receiver => receiver.slots.items ?? fail('The collection is not initialized.');
  define(ordered, 'initialize', 0, receiver => { receiver.slots.items = []; return receiver; }, 'initializing');
  define(ordered, 'copy', 0, receiver => {
    const copy = runtime.newObject(receiver.klass);
    Object.assign(copy.slots, receiver.slots, { items: [...items(receiver)] });
    return copy;
  }, 'copying');
  define(ordered, 'size', 0, receiver => BigInt(items(receiver).length), 'accessing');
  define(ordered, 'at:', 1, (receiver, [position]) => items(receiver)[index(position, items(receiver).length)], 'accessing');
  define(ordered, 'at:put:', 2, (receiver, [position, value]) => { items(receiver)[index(position, items(receiver).length)] = value; return value; }, 'accessing');
  define(ordered, 'addLast:', 1, (receiver, [value]) => { items(receiver).push(value); return value; }, 'adding');
  define(ordered, 'addFirst:', 1, (receiver, [value]) => { items(receiver).unshift(value); return value; }, 'adding');
  define(ordered, 'add:beforeIndex:', 2, (receiver, [value, position]) => {
    const list = items(receiver);
    list.splice(index(position, list.length + 1), 0, value);
    return value;
  }, 'adding');
  define(ordered, 'removeAtIndex:', 1, (receiver, [position]) => items(receiver).splice(index(position, items(receiver).length), 1)[0], 'removing');
  define(ordered, 'removeFirst', 0, receiver => items(receiver).length ? items(receiver).shift() : fail('The collection is empty.', 'EmptyCollection'), 'removing');
  define(ordered, 'removeLast', 0, receiver => items(receiver).length ? items(receiver).pop() : fail('The collection is empty.', 'EmptyCollection'), 'removing');

  const stream = get('WriteStream');
  const buffer = receiver => receiver.slots.buffer ?? fail('The stream is not initialized.');
  const streamKind = collection => typeof collection === 'string' || collection instanceof SmallSymbol ? 'String'
    : Array.isArray(collection) ? 'Array' : collection instanceof SmallObject && collection.klass === ordered ? 'OrderedCollection'
      : fail('A WriteStream needs a String, Array, or OrderedCollection.');
  define(stream, 'initializeOn:', 1, (receiver, [collection]) => {
    Object.assign(receiver.slots, { kind: streamKind(collection), buffer: [] });
    return receiver;
  }, 'initializing');
  define(stream, 'initializeWith:', 1, (receiver, [collection]) => {
    const kind = streamKind(collection);
    Object.assign(receiver.slots, { kind, buffer: kind === 'String' ? [text(collection)] : [...(kind === 'Array' ? collection : items(collection))] });
    return receiver;
  }, 'initializing');
  define(stream, 'reset', 0, receiver => { buffer(receiver).length = 0; return receiver; }, 'positioning');
  define(stream, 'nextPut:', 1, (receiver, [value]) => {
    if (receiver.slots.kind === 'String' && !(value instanceof SmallCharacter)) fail('A String stream accepts Characters. Use nextPutAll: for Strings.');
    buffer(receiver).push(receiver.slots.kind === 'String' ? value.text : value);
    return value;
  }, 'accessing');
  define(stream, 'nextPutAll:', 1, (receiver, [values]) => {
    if (receiver.slots.kind === 'String') buffer(receiver).push(text(values, 'A String stream accepts Strings and Symbols in nextPutAll:.'));
    else if (Array.isArray(values)) buffer(receiver).push(...values);
    else if (values instanceof SmallObject && values.klass === ordered) buffer(receiver).push(...items(values));
    else if (typeof values === 'string' || values instanceof SmallSymbol) buffer(receiver).push(...[...text(values)].map(item => SmallCharacter.of(item.codePointAt(0))));
    else fail('nextPutAll: requires a String, Symbol, Array, or OrderedCollection.');
    return values;
  }, 'accessing');
  define(stream, 'contents', 0, receiver => {
    const values = buffer(receiver);
    if (receiver.slots.kind === 'String') return values.join('');
    if (receiver.slots.kind === 'Array') return [...values];
    const result = runtime.newObject(ordered);
    result.slots.items = [...values];
    return result;
  }, 'accessing');

  const block = get('Block');
  define(block, 'argumentCount', 0, receiver => BigInt(receiver.code.args.length), 'accessing');
  define(block, 'valueWithArguments:', 1, (receiver, [args]) => {
    if (!Array.isArray(args)) fail('valueWithArguments: requires an Array.');
    if (args.length !== receiver.code.args.length) fail(`The block takes ${receiver.code.args.length} arguments, not ${args.length}.`);
    return new BlockCall(receiver, [...args]);
  }, 'evaluating');
}
