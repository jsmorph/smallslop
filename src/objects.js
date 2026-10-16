export class SmallClass {
  constructor(runtime, name, superclass, slots, category) {
    this.runtime = runtime;
    this.name = name;
    this.superclass = superclass;
    this.category = category;
    this.slots = Object.freeze([...(superclass?.slots ?? []), ...slots]);
    this.methods = new Map();
    if (new Set(this.slots).size !== this.slots.length) throw new Error(`Duplicate slot in ${name}.`);
  }
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
