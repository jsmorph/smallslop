import { Code, assemble } from './bytecode.js';
import { SendCall, SmallCharacter, SmallClass, SmallObject, SmallSymbol } from './objects.js';

function selectorName(value) {
  if (value instanceof SmallSymbol && value.name) return value.name;
  if (typeof value === 'string' && value) return value;
  throw new Error('A selector must be a nonempty Symbol or String.');
}

function installTextProtocol(runtime) {
  const protocol = (name, selector, arity, invoke, category) => runtime.primitive(runtime.classes.get(name), selector, arity, invoke, { protocol: category });
  protocol('String', 'asString', 0, receiver => receiver instanceof SmallSymbol ? receiver.name : receiver, 'converting');
  protocol('String', 'asSymbol', 0, receiver => receiver instanceof SmallSymbol ? receiver : SmallSymbol.of(receiver), 'converting');
  protocol('Symbol', 'numArgs', 0, receiver => {
    const name = receiver.name;
    if (/^[+*/\\~<>=@%&,?!|-]+$/.test(name)) return 1n;
    return BigInt((name.match(/:/g) ?? []).length);
  }, 'accessing');
  const character = (selector, invoke, category) => protocol('Character', selector, 0, invoke, category);
  const test = (selector, pattern) => character(selector, receiver => pattern.test(receiver.text), 'testing');
  character('codePoint', receiver => BigInt(receiver.codePoint), 'accessing');
  character('value', receiver => BigInt(receiver.codePoint), 'accessing');
  character('asInteger', receiver => BigInt(receiver.codePoint), 'converting');
  character('asCharacter', receiver => receiver, 'converting');
  character('asString', receiver => receiver.text, 'converting');
  character('asSymbol', receiver => SmallSymbol.of(receiver.text), 'converting');
  const changeCase = upper => receiver => {
    const changed = upper ? receiver.text.toUpperCase() : receiver.text.toLowerCase();
    return [...changed].length === 1 ? SmallCharacter.of(changed.codePointAt(0)) : receiver;
  };
  character('asUppercase', changeCase(true), 'converting');
  character('asLowercase', changeCase(false), 'converting');
  test('isLetter', /^\p{L}$/u);
  test('isDigit', /^\p{Nd}$/u);
  test('isAlphaNumeric', /^[\p{L}\p{Nd}]$/u);
  test('isUppercase', /^\p{Lu}$/u);
  test('isLowercase', /^\p{Ll}$/u);
  test('isVowel', /^[aeiouAEIOU]$/);
  test('isSeparator', /^[ \t\n\r\f]$/);
  protocol('Integer', 'asCharacter', 0, receiver => {
    if (receiver < 0n || receiver > 0x10ffffn) throw new Error('asCharacter requires a code point from 0 through 1114111.');
    return SmallCharacter.of(Number(receiver));
  }, 'converting');
}

function requireClass(value) {
  if (!(value instanceof SmallClass)) throw new Error('Expected a class.');
  return value;
}

function installObjectProtocol(runtime) {
  const object = runtime.classes.get('Object');
  const protocol = (klass, selector, arity, invoke, name) => runtime.primitive(klass, selector, arity, invoke, { protocol: name });
  protocol(object, 'copy', 0, receiver => {
    if (Array.isArray(receiver)) return [...receiver];
    if (!(receiver instanceof SmallObject)) return receiver;
    const copy = new SmallObject(receiver.klass);
    Object.assign(copy.slots, receiver.slots);
    return copy;
  }, 'copying');
  protocol(object, 'identityHash', 0, receiver => runtime.identityHash(receiver), 'comparing');
  protocol(object, 'isKindOf:', 1, (receiver, [klass]) => {
    requireClass(klass);
    for (let current = runtime.classOf(receiver); current; current = current.superclass) if (current === klass) return true;
    return false;
  }, 'testing');
  protocol(object, 'isMemberOf:', 1, (receiver, [klass]) => runtime.classOf(receiver) === requireClass(klass), 'testing');
  protocol(object, 'respondsTo:', 1, (receiver, [selector]) => runtime.lookup(runtime.classOf(receiver), selectorName(selector)) !== null, 'testing');
  protocol(object, 'error:', 1, (_receiver, [text]) => {
    if (typeof text !== 'string') throw new Error('error: requires a String.');
    throw new Error(text);
  }, 'error handling');
  for (let count = 0; count <= 3; count++) {
    const selector = `perform:${'with:'.repeat(count)}`;
    protocol(object, selector, count + 1, (receiver, [name, ...args]) => new SendCall(receiver, selectorName(name), args), 'message handling');
  }
  protocol(object, 'perform:withArguments:', 2, (receiver, [name, args]) => {
    if (!Array.isArray(args)) throw new Error('perform:withArguments: requires an Array of arguments.');
    return new SendCall(receiver, selectorName(name), [...args]);
  }, 'message handling');

  const klass = runtime.classes.get('Class');
  const classes = () => [...runtime.classes.values()].sort((a, b) => a.name.localeCompare(b.name));
  const subclasses = receiver => classes().filter(candidate => candidate.superclass === receiver);
  protocol(klass, 'name', 0, receiver => receiver.name, 'accessing');
  protocol(klass, 'category', 0, receiver => receiver.category, 'accessing');
  protocol(klass, 'superclass', 0, receiver => receiver.superclass, 'accessing class hierarchy');
  protocol(klass, 'subclasses', 0, receiver => subclasses(receiver), 'accessing class hierarchy');
  protocol(klass, 'allSubclasses', 0, receiver => {
    const result = [];
    const visit = current => { for (const child of subclasses(current)) { result.push(child); visit(child); } };
    visit(receiver);
    return result;
  }, 'accessing class hierarchy');
  protocol(klass, 'allSuperclasses', 0, receiver => {
    const result = [];
    for (let current = receiver.superclass; current; current = current.superclass) result.push(current);
    return result;
  }, 'accessing class hierarchy');
  protocol(klass, 'instVarNames', 0, receiver => receiver.slots.slice(receiver.superclass?.slots.length ?? 0), 'accessing instance variables');
  protocol(klass, 'allInstVarNames', 0, receiver => [...receiver.slots], 'accessing instance variables');
  protocol(klass, 'selectors', 0, receiver => [...receiver.methods.keys()].sort().map(name => SmallSymbol.of(name)), 'accessing methods');
  protocol(klass, 'includesSelector:', 1, (receiver, [selector]) => receiver.methods.has(selectorName(selector)), 'testing methods');
  protocol(klass, 'canUnderstand:', 1, (receiver, [selector]) => runtime.lookup(receiver, selectorName(selector)) !== null, 'testing methods');
  protocol(klass, 'inheritsFrom:', 1, (receiver, [other]) => {
    requireClass(other);
    for (let current = receiver.superclass; current; current = current.superclass) if (current === other) return true;
    return false;
  }, 'testing class hierarchy');
}

export function installKernel(runtime) {
  const primitives = {
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '<': (a, b) => a < b,
    '<=': (a, b) => a <= b,
    '>': (a, b) => a > b,
    '>=': (a, b) => a >= b,
  };
  for (const [name, type] of [['Integer', 'bigint'], ['Float', 'number']]) {
    const klass = runtime.classes.get(name);
    const binary = (selector, operation) => runtime.primitive(klass, selector, 1, (receiver, [argument]) => {
      if (typeof receiver !== type || typeof argument !== type) throw new Error(`${name} ${selector} requires two ${name} values.`);
      return operation(receiver, argument);
    }, { protocol: ['<', '<=', '>', '>='].includes(selector) ? 'comparing' : 'arithmetic' });
    for (const [selector, operation] of Object.entries(primitives)) binary(selector, operation);
    runtime.primitive(klass, 'negated', 0, receiver => -receiver, { protocol: 'arithmetic' });
    runtime.primitive(klass, 'asFloat', 0, receiver => Number(receiver), { protocol: 'converting' });
    runtime.primitive(klass, 'asString', 0, receiver => String(receiver), { protocol: 'converting' });
    if (name === 'Float') {
      binary('/', (a, b) => a / b);
      runtime.primitive(klass, 'truncated', 0, receiver => BigInt(Math.trunc(receiver)), { protocol: 'converting' });
    } else {
      binary('quo:', (a, b) => a / b);
      binary('rem:', (a, b) => a % b);
    }
  }
  const methods = {
    Object: ['= other ^self == other', '~= other ^(self = other) not', '~~ other ^(self == other) not',
      'hash ^self identityHash', 'isNil ^false', 'notNil ^true'],
    UndefinedObject: ['isNil ^true', 'notNil ^false'],
    True: [
      'not ^false', 'ifTrue: block ^block value', 'ifFalse: block ^nil',
      'ifTrue: yes ifFalse: no ^yes value', 'ifFalse: no ifTrue: yes ^yes value',
      'and: block ^block value', 'or: block ^true',
    ],
    False: [
      'not ^true', 'ifTrue: block ^nil', 'ifFalse: block ^block value',
      'ifTrue: yes ifFalse: no ^no value', 'ifFalse: no ifTrue: yes ^no value',
      'and: block ^false', 'or: block ^block value',
    ],
    Block: ['whileFalse: body ^[self value not] whileTrue: body'],
  };
  for (const [name, sources] of Object.entries(methods)) {
    for (const source of sources) runtime.installSource(runtime.classes.get(name), source, {
      protocol: ['Object', 'UndefinedObject'].includes(name) ? (source.startsWith('hash') ? 'comparing' : 'testing') : 'control',
    });
  }
  installObjectProtocol(runtime);
  installTextProtocol(runtime);
  runtime.install(runtime.classes.get('Block'), 'whileTrue:', new Code({
    args: ['body'], literals: ['value', null], source: 'whileTrue: body',
    bytes: assemble([
      ['label', 'condition'], ['self'], ['send', 0, 0], ['jumpFalse', 'done'],
      ['read', 0, 0], ['send', 0, 0], ['pop'], ['jump', 'condition'],
      ['label', 'done'], ['constant', 1], ['return'],
    ]),
  }), { protocol: 'control' });
}
