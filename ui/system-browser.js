import { Code, decode } from '../src/index.js';

const methods = {
  selecting: [
    `requireClean ^service call: 'requireClean' with: self hasChanges`,
    `hasChanges ^(draft ~= baseline) or: [draftProtocol ~= baselineProtocol]`,
    `clearMethod
      selector := nil. method := nil. creating := false.
      draft := ''. baseline := ''. message := ''.
      draftProtocol := protocol isNil ifTrue: ['unclassified'] ifFalse: [protocol].
      baselineProtocol := draftProtocol`,
    `loadMethod: version
      method := version. selector := version get: 'selector'. creating := false.
      draft := service call: 'source' with: version. baseline := draft.
      draftProtocol := version get: 'protocol'. baselineProtocol := draftProtocol.
      protocol isNil ifFalse: [protocol := draftProtocol].
      message := ''`,
    `selectCategory: name
      self requireClean. category := service call: 'category' with: name.
      className := nil. protocol := nil. self clearMethod. self render`,
    `selectClass: name
      self requireClean. className := service call: 'className' with: name.
      category isNil ifFalse: [category := service call: 'categoryFor' with: name].
      protocol := nil. self clearMethod. self render`,
    `selectSide: name
      self requireClean. side := service call: 'side' with: name.
      protocol := nil. self clearMethod. self render`,
    `selectProtocol: name
      self requireClean. protocol := service call: 'protocol' with: name.
      self clearMethod. self render`,
    `selectMethod: name
      self requireClean. self loadMethod: (service call: 'method' with: name). self render`,
  ],
  editing: [
    `close self requireClean. super close`,
    `editSource: text
      service call: 'requireEditable'. draft := service call: 'text' with: text. self render`,
    `editProtocol: name
      service call: 'requireEditable'. draftProtocol := service call: 'text' with: name. self render`,
    `newMethod
      self requireClean. service call: 'owner'. self clearMethod.
      creating := true. draft := 'newMethod
  ^self'. self render`,
    `accept
      service call: 'requireEditable'.
      self loadMethod: (service call: 'install' with: draft with: draftProtocol with: method).
      protocol := draftProtocol. message := 'Installed'. self render`,
    `revert
      selector isNil
        ifTrue: [self clearMethod]
        ifFalse: [self loadMethod: (service call: 'method' with: selector)].
      message := 'Reverted'. self render`,
  ],
  browsing: [
    `find: kind results := service call: 'find' with: kind. query := kind. self render`,
    `clearResults query := nil. results := nil. self render`,
    `browseClass: name method: selected
      self selectClass: name. side := 'instance'.
      selected isNil ifFalse: [self loadMethod: (service call: 'method' with: selected)].
      self render`,
    `toggleBreakpoint message := service call: 'toggleBreakpoint' with: method. self render`,
  ],
};

export function installSystemBrowser(world, superclass, { retainOnClose = false } = {}) {
  const klass = world.runtime.defineClass('SystemBrowser', { superclass, category: 'Tools-Browser',
    slots: ['category', 'className', 'side', 'protocol', 'selector', 'method', 'draft', 'baseline',
      'draftProtocol', 'baselineProtocol', 'creating', 'message', 'query', 'results', 'service'] });
  for (const [protocol, sources] of Object.entries(methods)) {
    for (const source of sources) {
      if (retainOnClose && source.startsWith("close ")) continue;
      world.runtime.installSource(klass, source, { protocol });
    }
  }
}

export class BrowserService {
  constructor(world, widget, { category = null, className = null } = {}) {
    this.world = world;
    this.widget = widget;
    Object.assign(this.slots, { category, className, side: 'instance',
      draft: '', baseline: '', draftProtocol: 'unclassified', baselineProtocol: 'unclassified',
      creating: false, message: '', service: world.host.value(this) });
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
    if (!this.state().editable) throw new Error('Select a source method or choose New method.');
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
      format: method?.format ?? null, editable: !!s.creating || method?.format === 'source',
      conflict: !!method && current !== method, breakpoints, message: s.message,
      query: s.query, results: s.results ? this.world.host.unwrap(s.results) : [],
    };
  }
}
