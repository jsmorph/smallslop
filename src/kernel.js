import { Code, assemble } from './bytecode.js';

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
    Object: ['= other ^self == other', '~= other ^(self = other) not', 'isNil ^false', 'notNil ^true'],
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
      protocol: ['Object', 'UndefinedObject'].includes(name) ? 'testing' : 'control',
    });
  }
  runtime.install(runtime.classes.get('Block'), 'whileTrue:', new Code({
    args: ['body'], literals: ['value', null], source: 'whileTrue: body',
    bytes: assemble([
      ['label', 'condition'], ['self'], ['send', 0, 0], ['jumpFalse', 'done'],
      ['read', 0, 0], ['send', 0, 0], ['pop'], ['jump', 'condition'],
      ['label', 'done'], ['constant', 1], ['return'],
    ]),
  }), { protocol: 'control' });
}
