import { defineClassElement, fileOut, installInterchangeElements, parseInterchange } from './interchange.js';

export function parseSourceFiles(files) {
  const elements = [];
  for (const { name, text } of files) {
    const className = /^([A-Za-z_][A-Za-z_0-9]*)\.st$/.exec(name)?.[1];
    if (!className) throw new Error(`${name}: a source file is named ClassName.st.`);
    let parsed;
    try { parsed = parseInterchange(text); }
    catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
    for (const element of parsed) {
      if ((element.name ?? element.className) !== className) throw new Error(`${name}: ${element.name ?? element.className} belongs in its own file.`);
      elements.push({ ...element, file: name });
    }
  }
  return elements;
}

export function orderClassDefinitions(elements) {
  const definitions = new Map();
  for (const element of elements.filter(item => item.type === 'class')) {
    if (definitions.has(element.name)) throw new Error(`${element.file}: ${element.name} is also defined in ${definitions.get(element.name).file}.`);
    definitions.set(element.name, element);
  }
  const ordered = [];
  const state = new Map();
  const visit = element => {
    if (state.get(element) === 'done') return;
    if (state.get(element) === 'visiting') throw new Error(`${element.file}: ${element.name} inherits from itself.`);
    state.set(element, 'visiting');
    const superclass = definitions.get(element.superclass);
    if (superclass) visit(superclass);
    state.set(element, 'done');
    ordered.push(element);
  };
  for (const element of definitions.values()) visit(element);
  return ordered;
}

export function loadSources(runtime, files, { beforeMethods } = {}) {
  const elements = parseSourceFiles(files);
  return installInterchangeElements(runtime, [...orderClassDefinitions(elements), ...elements.filter(item => item.type !== 'class')], { beforeMethods });
}

export function requireLoaded(result, packageName) {
  if (result.failures.length) {
    throw new Error(`The ${packageName} sources failed to load: ${result.failures.map(failure => `${failure.file}: ${failure.className}: ${failure.message}`).join('; ')}`);
  }
  return result;
}

export function loadClassFile(runtime, file) {
  const elements = parseSourceFiles([file]);
  const className = file.name.slice(0, -3);
  const failures = [];
  const definition = elements.find(element => element.type === 'class');
  if (definition) failures.push(...defineClassElement(runtime, definition).failures.map(failure => ({ ...failure, file: file.name })));
  const klass = runtime.classes.get(className);
  if (!klass) throw new Error(`${file.name}: ${className} is not defined.`);
  const kept = [];
  for (const [owner, type] of [[klass, 'method'], [klass.metaclass, 'classMethod']]) {
    const current = new Map([...owner.methods.values()].filter(method => method.format === 'source').map(method => [method.code.source, method]));
    const selectors = new Set();
    for (const element of elements.filter(item => item.type === type)) {
      const protocol = element.annotations.category ?? 'unclassified';
      let method = current.get(element.source);
      try {
        if (method?.protocol !== protocol) method = runtime.installSource(owner, element.source, { protocol });
        selectors.add(method.selector);
      } catch (error) {
        failures.push({ file: file.name, className: owner.name, source: element.source, message: error.message });
      }
    }
    kept.push([owner, selectors]);
  }
  if (failures.length) return failures;
  for (const [owner, selectors] of kept) {
    for (const method of [...owner.methods.values()]) if (method.format === 'source' && !selectors.has(method.selector)) runtime.removeMethod(owner, method.selector);
  }
  return failures;
}

export class SourceStore {
  constructor({ runtime, packages, report, label, defaultPackage, loaded = () => {} }) {
    this.runtime = runtime;
    this.report = report;
    this.label = label;
    this.defaultPackage = defaultPackage;
    this.loaded = loaded;
    this.packages = new Set(Object.keys(packages));
    this.files = new Map();
    this.dirty = new Set();
    this.channel = null;
    this.timer = null;
    this.writing = Promise.resolve();
    for (const [packageName, files] of Object.entries(packages)) {
      for (const { name, text, version } of files) this.files.set(name.slice(0, -3), { packageName, text, version, writing: null, unconfirmed: null, failed: false });
    }
    this.unsubscribe = runtime.subscribe(klass => this.changed(klass.name));
  }

  versions() {
    const versions = Object.fromEntries([...this.packages].map(name => [name, []]));
    for (const [className, entry] of this.files) if (entry.version !== null) versions[entry.packageName].push({ name: `${className}.st`, version: entry.version });
    return versions;
  }

  attach(write) {
    this.channel = { write };
    if (this.dirty.size) this.schedule();
  }

  detach() { this.channel = null; }

  adopt(klass, packageName = this.defaultPackage) {
    if (!this.files.has(klass.name)) this.files.set(klass.name, { packageName, text: null, version: null, writing: null, unconfirmed: null, failed: false });
    this.packages.add(packageName);
    this.changed(klass.name);
  }

  receive({ packageName, name: fileName, text, version }) {
    const className = fileName.slice(0, -3);
    let entry = this.files.get(className);
    if (!this.packages.has(packageName) || entry?.version === version) return;
    const file = `${packageName}/${fileName}`;
    if (entry && entry.packageName !== packageName) {
      this.report(new Error(`${file} defines ${className}, which this runtime loaded from ${entry.packageName}/${fileName}.`));
      return;
    }
    if (!entry) {
      entry = { packageName, text: null, version: null, writing: null, unconfirmed: null, failed: false };
      this.files.set(className, entry);
    }
    const klass = this.runtime.classes.get(className);
    const current = klass ? fileOut(klass) : null;
    if (text === entry.writing || text === entry.unconfirmed || text === current) {
      Object.assign(entry, { text, version, unconfirmed: null, failed: false });
      return;
    }
    if (klass && current !== entry.text && !entry.failed) {
      this.report(new Error(`${file} changed in another runtime before the ${this.label} saved its changes to ${className}.  The ${this.label} loaded the current file, and its unsaved changes to ${className} are lost.`));
    }
    Object.assign(entry, { text, version, unconfirmed: null, failed: false });
    let failures;
    try { failures = loadClassFile(this.runtime, { name: fileName, text }); }
    catch (error) { failures = [{ file: fileName, className, message: error.message }]; }
    if (failures.length) {
      entry.failed = true;
      this.report(new Error(`The ${this.label} cannot load ${file}, so it does not save ${className}: ${failures.map(failure => `${failure.className}: ${failure.message}`).join('; ')}`));
    }
    this.loaded(className);
  }

  changed(name) {
    if (!this.files.has(name)) return;
    this.dirty.add(name);
    if (this.channel) this.schedule();
  }

  schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.writing = this.writing.then(() => this.flush());
    }, 0);
  }

  async flush() {
    if (!this.channel) return;
    const names = [...this.dirty];
    this.dirty.clear();
    for (const name of names) {
      const entry = this.files.get(name);
      const klass = this.runtime.classes.get(name);
      if (entry.failed || !klass) continue;
      const text = fileOut(klass);
      if (text === entry.text) continue;
      const { channel } = this;
      const sent = entry.version;
      const file = `${entry.packageName}/${name}.st`;
      entry.writing = text;
      try {
        const version = await channel.write(entry.packageName, `${name}.st`, text, sent);
        if (entry.version === sent) Object.assign(entry, { text, version, unconfirmed: null });
      } catch (error) {
        if (channel !== this.channel) {
          entry.unconfirmed = text;
          this.dirty.add(name);
        }
        else if (error.status !== 412 || entry.version === sent) this.report(new Error(`The ${this.label} cannot save ${file}: ${error.message}`, { cause: error }));
      } finally {
        entry.writing = null;
      }
    }
  }

  async settled() {
    while (this.timer !== null || (this.channel && this.dirty.size)) {
      await new Promise(resolve => setTimeout(resolve, 0));
      await this.writing;
    }
    await this.writing;
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
    this.channel = null;
    this.unsubscribe();
  }
}
