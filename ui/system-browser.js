import { Code, classDefinition, decode, defineClassElement, definitionText, fileIn, fileOut, parseInterchangeElements } from '../src/index.js';

export class BrowserService {
  constructor(world, widget, { category = null, className = null } = {}) {
    this.world = world;
    this.widget = widget;
    Object.assign(this.slots, { category, className, side: 'instance',
      draft: '', baseline: '', draftProtocol: 'unclassified', baselineProtocol: 'unclassified',
      creating: false, defining: false, message: '', service: world.host.value(this) });
    if (className) this.slots.draft = this.slots.baseline = this.definition();
    this.slots.defining = !!className;
  }

  get slots() { return this.widget.object.slots; }
  get runtime() { return this.world.runtime; }

  requireClean(dirty) {
    if (dirty) throw new Error('Accept or revert the current draft before changing the selection.');
  }

  text(value) {
    if (typeof value !== 'string') throw new Error('Expected text.');
    return value;
  }

  category(name) {
    if (name !== null && ![...this.runtime.classes.values()].some(klass => klass.category === name)) throw new Error(`Unknown category: ${name}.`);
    return name;
  }

  className(name) {
    if (!this.runtime.classes.has(name)) throw new Error(`Unknown class: ${name}.`);
    return name;
  }

  hasClass(name) { return this.runtime.classes.has(name); }

  categoryFor(name) { return this.runtime.classes.get(this.className(name)).category; }

  side(name) {
    if (!['instance', 'class'].includes(name)) throw new Error('Choose instance or class behavior.');
    return name;
  }

  owner() {
    const { className, side } = this.slots;
    if (!className) throw new Error('Select a class.');
    const klass = this.runtime.classes.get(this.className(className));
    return side === 'class' ? klass.metaclass : klass;
  }

  protocol(name) {
    if (name !== null && ![...this.owner().methods.values()].some(method => method.protocol === name)) throw new Error(`Unknown protocol: ${name}.`);
    return name;
  }

  method(selector) {
    const method = this.owner().methods.get(selector);
    if (!method) throw new Error(`Unknown method: ${selector}.`);
    return method;
  }

  source(method) {
    if (method.format === 'source') return method.code.source;
    if (method.invoke) return String(method.invoke);
    const lines = [];
    const visit = (code, path) => {
      lines.push(`Bytecode ${path.length ? `block ${path.join('.')}` : method.selector}`);
      for (const pc of code.boundaries) {
        const { name, args } = decode(code.bytes, pc);
        lines.push(`${String(pc).padStart(4)}  ${name} ${args.join(' ')}`.trimEnd());
      }
      code.literals.forEach((literal, index) => { if (literal instanceof Code) visit(literal, [...path, index]); });
    };
    visit(method.code, []);
    return lines.join('\n');
  }

  requireEditable() {
    if (!this.state().editable) throw new Error('Select a class or a source method, or choose New method or New class.');
  }

  definition() {
    return classDefinition(this.runtime.classes.get(this.className(this.slots.className)));
  }

  classTemplate() {
    const { category, className } = this.slots;
    return definitionText({ name: 'NewClass', superclass: className ?? 'Object', category: category ?? 'Unclassified' });
  }

  define(text) {
    const elements = parseInterchangeElements(text);
    if (elements.length !== 1 || elements[0].type !== 'class') throw new Error('Accept one class definition, followed by its annotations.');
    const { klass, failures } = defineClassElement(this.runtime, elements[0]);
    return { className: klass.name, message: [`Defined ${klass.name}`,
      ...failures.map(({ className, selector, message }) => `${className}>>${selector} failed to recompile: ${message}`)].join('. ') };
  }

  fileIn(text) {
    const { classes, methods, failures } = fileIn(this.runtime, text);
    const count = (items, noun) => `${items.length} ${noun}${items.length === 1 ? '' : noun.endsWith('s') ? 'es' : 's'}`;
    return [`Filed in ${count(classes, 'class')} and ${count(methods, 'method')}`,
      ...failures.map(({ className, selector, source, message }) => `${className}>>${selector ?? source.split('\n')[0]} failed: ${message}`)].join('. ');
  }

  fileOut() {
    const klass = this.runtime.classes.get(this.className(this.slots.className));
    return { fileName: `${klass.name}.st`, text: fileOut(klass) };
  }

  install(source, protocol, method) {
    return this.runtime.installSource(this.owner(), source, {
      protocol, expectedMethodId: method?.id ?? null, selector: method?.selector,
    });
  }

  toggleBreakpoint(method) {
    if (!method?.code) throw new Error('Select a bytecode or source method.');
    const entries = [...this.runtime.breakpoints].filter(([, entry]) => entry.method === method && entry.pc === 0 && entry.code === method.code);
    if (entries.length) {
      for (const [id] of entries) this.runtime.clearBreakpoint(id);
      return `Cleared entry breakpoint for version ${method.id}`;
    }
    this.runtime.breakpoint(method);
    return `Entry breakpoint set for version ${method.id}`;
  }

  find(kind) {
    const { className, selector } = this.slots;
    const debugger_ = this.world.inspector;
    if (['senders', 'implementors', 'inheritance'].includes(kind) && !selector) throw new Error('Select a method.');
    if (kind === 'senders') return debugger_.methods({ sends: selector });
    if (kind === 'implementors') return debugger_.methods({ selector });
    const owner = this.owner();
    if (kind === 'inheritance') {
      const found = [];
      for (let klass = owner; klass; klass = klass.superclass) {
        if (klass.methods.has(selector)) found.push({ className: klass.name, selector });
      }
      return found;
    }
    if (kind === 'variables') {
      const found = [];
      for (let klass = owner; klass; klass = klass.superclass) {
        for (const name of klass.slots.filter(slot => !klass.superclass?.slots.includes(slot))) found.push({ className: klass.name, label: `${klass.name}: ${name}` });
      }
      return found;
    }
    if (kind === 'hierarchy') {
      const selected = this.runtime.classes.get(className);
      const ancestors = [];
      for (let klass = selected.superclass; klass; klass = klass.superclass) ancestors.unshift(klass);
      const found = ancestors.map((klass, depth) => ({ className: klass.name, depth }));
      const visit = (klass, depth) => {
        found.push({ className: klass.name, depth });
        for (const child of [...this.runtime.classes.values()].filter(child => child.superclass === klass).sort((a, b) => a.name.localeCompare(b.name))) visit(child, depth + 1);
      };
      visit(selected, ancestors.length);
      return found;
    }
    throw new Error(`Unknown browser search: ${kind}.`);
  }

  state() {
    const s = this.slots;
    const allClasses = this.world.inspector.classes();
    const klass = this.runtime.classes.get(s.className);
    const owner = klass ? this.owner() : null;
    const allMethods = owner ? this.world.inspector.methods({ className: owner.name }) : [];
    const method = s.method ? this.world.host.unwrap(s.method) : null;
    const dirty = s.draft !== s.baseline || s.draftProtocol !== s.baselineProtocol;
    const current = method ? owner?.methods.get(method.selector) : null;
    const breakpoints = method ? [...this.runtime.breakpoints].filter(([, entry]) => entry.method === method && entry.pc === 0 && entry.code === method.code).map(([id]) => id) : [];
    return {
      category: s.category, className: s.className, side: s.side, protocol: s.protocol, selector: s.selector,
      categories: [...new Set(allClasses.map(klass => klass.category))].sort(),
      classes: allClasses.filter(klass => s.category === null || klass.category === s.category),
      protocols: [...new Set(allMethods.map(method => method.protocol))].sort(),
      methods: allMethods.filter(method => s.protocol === null || method.protocol === s.protocol),
      owner: owner?.name ?? null, superclass: owner?.superclass?.name ?? null, slots: owner?.slots ?? [],
      inheritedSlots: owner?.superclass?.slots ?? [],
      source: s.draft, draftProtocol: s.draftProtocol, dirty, creating: s.creating,
      methodId: method?.id ?? null, currentMethodId: current?.id ?? null,
      format: method?.format ?? null, defining: !!s.defining, editable: !!s.creating || !!s.defining || method?.format === 'source',
      conflict: !!method && current !== method, breakpoints, message: s.message,
      query: s.query, results: s.results ? this.world.host.unwrap(s.results) : [],
    };
  }
}
