import { fileOut } from '../src/index.js';

export async function fetchSources(packages, base = new URL('/api/smalltalk/', location.href)) {
  const entries = await Promise.all(packages.map(async name => {
    const response = await fetch(new URL(name, base), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cannot load the ${name} sources: ${response.status} ${await response.text()}`);
    return [name, await response.json()];
  }));
  return Object.fromEntries(entries);
}

export class SourceStore {
  constructor({ runtime, packages, report, base = new URL('/api/smalltalk/', location.href), defaultPackage = 'workspace' }) {
    this.runtime = runtime;
    this.report = report;
    this.base = base;
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
      try {
        const response = await fetch(new URL(`${entry.packageName}/${name}.st`, this.base), {
          method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(entry.version === null ? { 'If-None-Match': '*' } : { 'If-Match': `"${entry.version}"` }) },
        });
        if (response.status === 412) {
          entry.conflict = true;
          throw new Error(`${entry.packageName}/${name}.st changed on the server after this page read it.  The page's changes to ${name} are not saved.  Reload the page to load the current file.`);
        }
        if (!response.ok) throw new Error(`Cannot save ${entry.packageName}/${name}.st: ${response.status} ${await response.text()}`);
        Object.assign(entry, { text, version: response.headers.get('ETag').slice(1, -1) });
      } catch (error) {
        this.report(error);
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
