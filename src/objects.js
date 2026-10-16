export class SmallClass {
  constructor(runtime, name, superclass, slots, category, instanceClass = null) {
    this.runtime = runtime;
    this.name = name;
    this.superclass = superclass;
    this.category = category;
    this.slots = Object.freeze([...(superclass?.slots ?? []), ...slots]);
    this.methods = new Map();
    this.instanceClass = instanceClass;
    this.metaclass = null;
    this.slotValues = {};
    if (new Set(this.slots).size !== this.slots.length) throw new Error(`Duplicate slot in ${name}.`);
  }

  get meta() { return this.instanceClass !== null; }
}

export class SmallObject {
  constructor(klass) {
    this.klass = klass;
    this.slots = Object.fromEntries(klass.slots.map(name => [name, null]));
  }
}

export class BlockCall {
  constructor(block, args) {
    this.block = block;
    this.args = args;
  }
}

export class SendCall {
  constructor(receiver, selector, args) {
    this.receiver = receiver;
    this.selector = selector;
    this.args = args;
  }
}

const symbols = new Map();
const characters = new Map();

export class SmallSymbol {
  constructor(name, key) {
    if (key !== symbols) throw new Error('Use SmallSymbol.of to create a Symbol.');
    this.name = name;
    Object.freeze(this);
  }

  static of(name) {
    if (typeof name !== 'string') throw new Error('A Symbol needs a String.');
    let symbol = symbols.get(name);
    if (!symbol) symbols.set(name, symbol = new SmallSymbol(name, symbols));
    return symbol;
  }
}

export class SmallCharacter {
  constructor(codePoint, key) {
    if (key !== characters) throw new Error('Use SmallCharacter.of to create a Character.');
    this.codePoint = codePoint;
    Object.freeze(this);
  }

  static of(codePoint) {
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) throw new Error('A Character needs a code point from 0 through 1114111.');
    let character = characters.get(codePoint);
    if (!character) characters.set(codePoint, character = new SmallCharacter(codePoint, characters));
    return character;
  }

  get text() { return String.fromCodePoint(this.codePoint); }
}
