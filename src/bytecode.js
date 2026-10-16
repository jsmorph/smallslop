export const Op = Object.freeze({
  constant: 0, self: 1, read: 2, write: 3, slot: 4, storeSlot: 5,
  send: 6, superSend: 7, block: 8, pop: 9, return: 10,
  nonlocalReturn: 11, jump: 12, jumpFalse: 13, global: 14, dup: 15,
});

const operands = Object.freeze([1, 0, 2, 2, 1, 1, 2, 2, 1, 0, 0, 0, 1, 1, 1, 0]);
const names = Object.keys(Op);

export function assemble(instructions) {
  const labels = new Map();
  let pc = 0;
  for (const [name, ...args] of instructions) {
    if (name === 'label') {
      if (args.length !== 1 || typeof args[0] !== 'string' || !args[0] || labels.has(args[0])) throw new Error('Invalid or duplicate label.');
      labels.set(args[0], pc);
    } else {
      if (!Object.hasOwn(Op, name) || args.length !== operands[Op[name]]) throw new Error(`Invalid instruction: ${name}.`);
      pc += 1 + 2 * args.length;
    }
  }
  const bytes = [];
  for (const [name, ...args] of instructions) {
    if (name === 'label') continue;
    const op = Object.hasOwn(Op, name) ? Op[name] : undefined;
    if (op === undefined || args.length !== operands[op]) {
      throw new Error(`Invalid instruction: ${name}.`);
    }
    bytes.push(op);
    for (let arg of args) {
      if (typeof arg === 'string' && [Op.jump, Op.jumpFalse].includes(op)) arg = labels.get(arg);
      if (!Number.isInteger(arg) || arg < 0 || arg > 65535) {
        throw new Error(`Instruction operand is outside 0..65535: ${arg}.`);
      }
      bytes.push(arg >>> 8, arg & 255);
    }
  }
  return bytes;
}

export function decode(bytes, pc) {
  const op = bytes[pc];
  if (!Number.isInteger(pc) || pc < 0 || operands[op] === undefined) {
    throw new Error(`Invalid instruction position: ${pc}.`);
  }
  const next = pc + 1 + 2 * operands[op];
  if (next > bytes.length) throw new Error(`Truncated instruction at ${pc}.`);
  const args = [];
  for (let i = pc + 1; i < next; i += 2) args.push(bytes[i] * 256 + bytes[i + 1]);
  return { op, name: names[op], args, next };
}

export class Code {
  constructor({ args = [], locals = [], bytes, literals = [], source = '', positions = [] }) {
    if (typeof source !== 'string') throw new Error('Source must be a string.');
    const variables = [...args, ...locals];
    if (variables.some(name => typeof name !== 'string' || !name) || new Set(variables).size !== variables.length) {
      throw new Error('Arguments and locals must have distinct names.');
    }
    this.args = Object.freeze([...args]);
    this.locals = Object.freeze([...locals]);
    this.bytes = Object.freeze([...bytes]);
    this.literals = Object.freeze([...literals]);
    this.source = source;
    this.positions = Object.freeze(positions.map(position => Object.freeze({ ...position })));
    if (this.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new Error('Bytecode must contain bytes.');
    }
    const boundaries = [];
    for (let pc = 0; pc < this.bytes.length;) {
      boundaries.push(pc);
      pc = decode(this.bytes, pc).next;
    }
    if (!boundaries.length) throw new Error('Code must contain an instruction.');
    this.boundaries = Object.freeze(boundaries);
    for (const pc of boundaries) {
      const { op, args: values } = decode(this.bytes, pc);
      if ([Op.constant, Op.slot, Op.storeSlot, Op.send, Op.superSend, Op.block, Op.global].includes(op)
          && values[0] >= literals.length) throw new Error(`Missing literal at ${pc}.`);
      if ([Op.jump, Op.jumpFalse].includes(op) && !boundaries.includes(values[0])) {
        throw new Error(`Jump at ${pc} targets an invalid instruction.`);
      }
      if (op === Op.block && !(literals[values[0]] instanceof Code)) {
        throw new Error(`Block at ${pc} needs compiled code.`);
      }
      if ([Op.send, Op.superSend, Op.slot, Op.storeSlot, Op.global].includes(op)
          && typeof literals[values[0]] !== 'string') throw new Error(`Expected a name at ${pc}.`);
    }
    const depths = new Map();
    const pending = [[0, 0]];
    while (pending.length) {
      const [pc, depth] = pending.pop();
      if (!boundaries.includes(pc)) throw new Error('Execution can fall past the end of the code.');
      if (depths.has(pc)) {
        if (depths.get(pc) !== depth) throw new Error(`Inconsistent operand stack depth at ${pc}.`);
        continue;
      }
      depths.set(pc, depth);
      const { op, args: values, next } = decode(this.bytes, pc);
      const required = [Op.send, Op.superSend].includes(op) ? values[1] + 1
        : [Op.write, Op.storeSlot, Op.pop, Op.return, Op.nonlocalReturn, Op.jumpFalse, Op.dup].includes(op) ? 1 : 0;
      if (depth < required) throw new Error(`Operand stack underflow at ${pc}.`);
      if ([Op.return, Op.nonlocalReturn].includes(op)) continue;
      const change = [Op.constant, Op.self, Op.read, Op.slot, Op.block, Op.global, Op.dup].includes(op) ? 1
        : [Op.pop, Op.jumpFalse].includes(op) ? -1
          : [Op.send, Op.superSend].includes(op) ? -values[1] : 0;
      if (op !== Op.jump) pending.push([next, depth + change]);
      if ([Op.jump, Op.jumpFalse].includes(op)) pending.push([values[0], depth + change]);
    }
    for (const position of this.positions) {
      if (!boundaries.includes(position.pc) || !Number.isInteger(position.start)
          || !Number.isInteger(position.end) || position.start < 0
          || position.end < position.start || position.end > source.length) {
        throw new Error('Invalid source position.');
      }
    }
    Object.freeze(this);
  }
}
