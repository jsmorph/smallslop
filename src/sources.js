import { fileOut, installInterchangeElements, parseInterchange } from './interchange.js';

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

export class SourceStore {
  constructor({ runtime, packages, write, report, label, defaultPackage }) {
    this.runtime = runtime;
    this.write = write;
    this.report = report;
    this.label = label;
    this.defaultPackage = defaultPackage;
    this.files = new Map();
    this.dirty = new Set();
    this.timer = null;
    this.writing = Promise.resolve();
    for (const [packageName, files] of Object.entries(packages)) {
      for (const { name, text, version } of files) this.files.set(name.slice(0, -3), { packageName, text, version, conflict: false });
    }
    this.unsubscribe = runtime.subscribe(klass => this.changed(klass.name));
  }

  adopt(klass, packageName = this.defaultPackage) {
    if (!this.files.has(klass.name)) this.files.set(klass.name, { packageName, text: null, version: null, conflict: false });
    this.changed(klass.name);
  }

  changed(name) {
    if (!this.files.has(name)) return;
    this.dirty.add(name);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.writing = this.writing.then(() => this.flush());
    }, 0);
  }

  async flush() {
    const names = [...this.dirty];
    this.dirty.clear();
    for (const name of names) {
      const entry = this.files.get(name);
      const klass = this.runtime.classes.get(name);
      if (entry.conflict || !klass) continue;
      const text = fileOut(klass);
      if (text === entry.text) continue;
      const file = `${entry.packageName}/${name}.st`;
      try {
        Object.assign(entry, { text, version: await this.write(entry.packageName, `${name}.st`, text, entry.version) });
      } catch (error) {
        if (error.status !== 412) { this.report(new Error(`Cannot save ${file}: ${error.message}`, { cause: error })); continue; }
        entry.conflict = true;
        this.report(new Error(`${file} changed after the ${this.label} read it.  The ${this.label}'s changes to ${name} are not saved.  Reload the page to load the current file.`, { cause: error }));
      }
    }
  }

  async settled() {
    while (this.timer !== null || this.dirty.size) {
      await new Promise(resolve => setTimeout(resolve, 0));
      await this.writing;
    }
    await this.writing;
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe();
  }
}
