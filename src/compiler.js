import { Code, assemble } from './bytecode.js';

const reserved = new Set(['self', 'super', 'nil', 'true', 'false']);

function fail(source, position, message) {
  const before = source.slice(0, position);
  const line = before.split('\n').length;
  const column = position - before.lastIndexOf('\n');
  const error = new SyntaxError(`${message} (${line}:${column})`);
  Object.assign(error, { position, line, column });
  throw error;
}

function tokenize(source) {
  const tokens = [];
  let offset = 0;
  const add = (kind, value, start) => tokens.push({ kind, value, start, end: offset });
  while (offset < source.length) {
    const start = offset;
    const char = source[offset];
    if (/\s/.test(char)) { offset++; continue; }
    if (char === '"') {
      const end = source.indexOf('"', offset + 1);
      if (end < 0) fail(source, start, 'Unterminated comment');
      offset = end + 1;
      continue;
    }
    if (char === "'") {
      offset++;
      let value = '';
      let closed = false;
      while (offset < source.length) {
        const next = source[offset++];
        if (next !== "'") value += next;
        else if (source[offset] === "'") { value += "'"; offset++; }
        else { closed = true; break; }
      }
      if (!closed) fail(source, start, 'Unterminated string');
      add('string', value, start);
      continue;
    }
    const number = source.slice(offset).match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      offset += number[0].length;
      add('number', /[.eE]/.test(number[0]) ? Number(number[0]) : BigInt(number[0]), start);
      continue;
    }
    const name = source.slice(offset).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if (name) {
      offset += name[0].length;
      if (source[offset] === ':' && source[offset + 1] !== '=') {
        offset++;
        add('keyword', `${name[0]}:`, start);
      } else add('name', name[0], start);
      continue;
    }
    if (source.startsWith(':=', offset)) { offset += 2; add('assign', ':=', start); continue; }
    if ('()[]^.|:'.includes(char)) { offset++; add(char, char, start); continue; }
    const binary = source.slice(offset).match(/^[+*/\\~<>=@%&,?!-]+/);
    if (binary) { offset += binary[0].length; add('binary', binary[0], start); continue; }
    fail(source, start, `Unexpected character ${JSON.stringify(char)}`);
  }
  tokens.push({ kind: 'end', value: '', start: offset, end: offset });
  return tokens;
}

class Parser {
  constructor(source) {
    if (typeof source !== 'string') throw new TypeError('Source must be a string.');
    this.source = source;
    this.tokens = tokenize(source);
    this.index = 0;
  }

  get current() { return this.tokens[this.index]; }

  take(kind) {
    const token = this.current;
    if (kind && token.kind !== kind) fail(this.source, token.start, `Expected ${kind}, found ${token.kind}`);
    this.index++;
    return token;
  }

  accept(kind) {
    return this.current.kind === kind ? this.take() : null;
  }

  binding() {
    const name = this.take('name');
    if (reserved.has(name.value)) fail(this.source, name.start, `Reserved name ${name.value}`);
    return name;
  }

  method() {
    let selector = '';
    const args = [];
    if (this.current.kind === 'name') selector = this.take().value;
    else if (this.current.kind === 'binary' || this.current.kind === '|') {
      selector = this.take().value;
      args.push(this.binding());
    } else if (this.current.kind === 'keyword') {
      while (this.current.kind === 'keyword') {
        selector += this.take().value;
        args.push(this.binding());
      }
    } else fail(this.source, this.current.start, 'Expected a method selector');
    const body = this.sequence('end');
    this.take('end');
    return { selector, args, ...body };
  }

  sequence(terminator) {
    const locals = [];
    const statements = [];
    if (this.accept('|')) {
      while (this.current.kind === 'name') locals.push(this.binding());
      this.take('|');
    }
    while (this.current.kind !== terminator) {
      if (this.current.kind === 'end') fail(this.source, this.current.start, `Expected ${terminator}`);
      const returned = this.accept('^');
      const expression = this.expression();
      statements.push(returned ? { type: 'return', value: expression, start: returned.start, end: expression.end } : expression);
      if (this.current.kind !== terminator) this.take('.');
      if (returned && this.current.kind !== terminator) fail(this.source, this.current.start, 'Statement after return');
    }
    return { locals, statements, end: this.current.start };
  }

  expression() {
    if (this.current.kind === 'name' && this.tokens[this.index + 1].kind === 'assign') {
      const name = this.binding();
      this.take('assign');
      const value = this.expression();
      return { type: 'assign', name: name.value, value, start: name.start, end: value.end };
    }
    let receiver = this.binary();
    if (this.current.kind === 'keyword') {
      let selector = '';
      const args = [];
      while (this.current.kind === 'keyword') {
        selector += this.take().value;
        args.push(this.binary());
      }
      receiver = { type: 'send', receiver, selector, args, start: receiver.start, end: args.at(-1).end };
    }
    return receiver;
  }

  binary() {
    let receiver = this.unary();
    while (this.current.kind === 'binary' || this.current.kind === '|') {
      const selector = this.take().value;
      const argument = this.unary();
      receiver = { type: 'send', receiver, selector, args: [argument], start: receiver.start, end: argument.end };
    }
    return receiver;
  }

  unary() {
    let receiver = this.primary();
    while (this.current.kind === 'name') {
      const selector = this.take();
      receiver = { type: 'send', receiver, selector: selector.value, args: [], start: receiver.start, end: selector.end };
    }
    return receiver;
  }

  primary() {
    const token = this.current;
    if (['number', 'string'].includes(token.kind)) {
      this.take();
      return { ...token, type: 'literal' };
    }
    if (token.kind === 'binary' && token.value === '-' && this.tokens[this.index + 1].kind === 'number') {
      this.take();
      const value = this.take('number');
      return { type: 'literal', value: -value.value, start: token.start, end: value.end };
    }
    if (token.kind === 'name') { this.take(); return { ...token, type: 'variable', name: token.value }; }
    if (this.accept('(')) {
      const value = this.expression();
      this.take(')');
      return value;
    }
    if (this.accept('[')) {
      const args = [];
      while (this.accept(':')) args.push(this.binding());
      if (args.length) this.take('|');
      const body = this.sequence(']');
      const end = this.take(']').end;
      return { type: 'block', args, ...body, start: token.start, end };
    }
    fail(this.source, token.start, 'Expected an expression');
  }
}

class Emitter {
  constructor(klass, source, args, locals, parents, isBlock) {
    const bindings = [...args, ...locals];
    const seen = new Set();
    for (const binding of bindings) {
      if (seen.has(binding.value)) fail(source, binding.start, `Duplicate binding ${binding.value}`);
      seen.add(binding.value);
    }
    this.klass = klass;
    this.source = source;
    this.args = args.map(token => token.value);
    this.locals = locals.map(token => token.value);
    this.scopes = [[...this.args, ...this.locals], ...parents];
    this.isBlock = isBlock;
    this.bytes = [];
    this.literals = [];
    this.positions = [];
  }

  literal(value) {
    let index = this.literals.findIndex(item => Object.is(item, value));
    if (index < 0) { index = this.literals.length; this.literals.push(value); }
    return index;
  }

  emit(node, name, ...args) {
    this.positions.push({ pc: this.bytes.length, start: node.start, end: node.end });
    this.bytes.push(...assemble([[name, ...args]]));
  }

  binding(node, writing) {
    for (let depth = 0; depth < this.scopes.length; depth++) {
      const index = this.scopes[depth].indexOf(node.name);
      if (index >= 0) { this.emit(node, writing ? 'write' : 'read', depth, index); return; }
    }
    if (this.klass.slots.includes(node.name)) {
      this.emit(node, writing ? 'storeSlot' : 'slot', this.literal(node.name));
      return;
    }
    if (!writing && (/^[A-Z]/.test(node.name) || this.klass.runtime.classes.has(node.name))) {
      this.emit(node, 'global', this.literal(node.name));
      return;
    }
    fail(this.source, node.start, `Unknown ${writing ? 'binding' : 'name'} ${node.name}`);
  }

  expression(node) {
    switch (node.type) {
      case 'literal': this.emit(node, 'constant', this.literal(node.value)); break;
      case 'variable':
        if (node.name === 'self') this.emit(node, 'self');
        else if (['nil', 'true', 'false'].includes(node.name)) {
          this.emit(node, 'constant', this.literal(({ nil: null, true: true, false: false })[node.name]));
        } else if (node.name === 'super') fail(this.source, node.start, 'super requires a message');
        else this.binding(node, false);
        break;
      case 'assign': this.expression(node.value); this.binding(node, true); break;
      case 'send': {
        const superSend = node.receiver.type === 'variable' && node.receiver.name === 'super';
        if (superSend) this.emit(node.receiver, 'self');
        else this.expression(node.receiver);
        for (const argument of node.args) this.expression(argument);
        this.emit(node, superSend ? 'superSend' : 'send', this.literal(node.selector), node.args.length);
        break;
      }
      case 'block': {
        const emitter = new Emitter(this.klass, this.source, node.args, node.locals, this.scopes, true);
        this.emit(node, 'block', this.literal(emitter.body(node, false)));
        break;
      }
      case 'return': this.expression(node.value); this.emit(node, this.isBlock ? 'nonlocalReturn' : 'return'); break;
      default: throw new Error(`Unknown expression: ${node.type}.`);
    }
  }

  body(body, method) {
    for (let i = 0; i < body.statements.length; i++) {
      const statement = body.statements[i];
      this.expression(statement);
      if (statement.type !== 'return' && (method || i < body.statements.length - 1)) this.emit(statement, 'pop');
    }
    if (body.statements.at(-1)?.type !== 'return') {
      const end = { start: body.end, end: body.end };
      if (method) this.emit(end, 'self');
      else if (!body.statements.length) this.emit(end, 'constant', this.literal(null));
      this.emit(end, 'return');
    }
    return new Code(this);
  }
}

export function compileMethod(klass, source) {
  const parsed = new Parser(source).method();
  const emitter = new Emitter(klass, source, parsed.args, parsed.locals, [], false);
  return { selector: parsed.selector, code: emitter.body(parsed, true) };
}

export function compileExpression(klass, source, { scopes = [] } = {}) {
  const parser = new Parser(source);
  const parsed = parser.sequence('end');
  parser.take('end');
  return new Emitter(klass, source, [], parsed.locals, scopes, false).body(parsed, false);
}
