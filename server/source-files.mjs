import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceRoot = fileURLToPath(new URL('../smalltalk/', import.meta.url));

const packagePattern = /^[a-z][a-z0-9-]*$/;
const filePattern = /^[A-Za-z_][A-Za-z_0-9]*\.st$/;

export function sourceVersion(text) {
  return createHash('sha256').update(text).digest('base64url');
}

function packageDirectory(root, name) {
  if (!packagePattern.test(name)) throw Object.assign(new Error(`Invalid source package: ${name}.`), { status: 400 });
  return join(root, name);
}

const entry = (name, text) => ({ name, text, version: sourceVersion(text) });

export function readPackageSync(name, root = sourceRoot) {
  const directory = packageDirectory(root, name);
  return readdirSync(directory).filter(file => filePattern.test(file)).sort()
    .map(file => entry(file, readFileSync(join(directory, file), 'utf8')));
}

export async function readPackage(name, root = sourceRoot) {
  const directory = packageDirectory(root, name);
  const files = (await readdir(directory)).filter(file => filePattern.test(file)).sort();
  return Promise.all(files.map(async file => entry(file, await readFile(join(directory, file), 'utf8'))));
}

export class SourceFiles {
  constructor(root = sourceRoot) {
    this.root = root;
    this.queues = new Map();
    this.subscribers = new Set();
  }

  readSync(name) { return readPackageSync(name, this.root); }

  read(name) { return readPackage(name, this.root); }

  #queue(name, file, operation) {
    const key = join(name, file);
    const next = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(key, next);
    const clear = () => { if (this.queues.get(key) === next) this.queues.delete(key); };
    next.then(clear, clear);
    return next;
  }

  #notify(update) {
    for (const subscriber of this.subscribers) if (subscriber.packages.has(update.packageName)) subscriber.listener(update);
  }

  async subscribe(packages, listener) {
    if (!packages || typeof packages !== 'object' || !Object.values(packages).every(files => Array.isArray(files)
        && files.every(file => typeof file?.name === 'string' && typeof file.version === 'string'))) {
      throw Object.assign(new Error('A source subscription requires {package: [{name, version}]}.'), { status: 400 });
    }
    const subscriber = { packages: new Set(Object.keys(packages)), listener };
    this.subscribers.add(subscriber);
    const unsubscribe = () => { this.subscribers.delete(subscriber); };
    try {
      await Promise.all(Object.entries(packages).map(async ([name, files]) => {
        const known = new Map(files.map(file => [file.name, file.version]));
        const directory = packageDirectory(this.root, name);
        const names = (await readdir(directory)).filter(file => filePattern.test(file));
        await Promise.all(names.map(file => this.#queue(name, file, async () => {
          const text = await readFile(join(directory, file), 'utf8');
          const version = sourceVersion(text);
          if (known.get(file) !== version) listener({ packageName: name, name: file, text, version });
        })));
      }));
    } catch (error) {
      unsubscribe();
      throw error;
    }
    return unsubscribe;
  }

  write(name, file, text, expectedVersion) {
    if (!filePattern.test(file)) return Promise.reject(Object.assign(new Error(`Invalid source file name: ${file}.`), { status: 400 }));
    if (typeof text !== 'string') return Promise.reject(Object.assign(new Error('Source text must be a string.'), { status: 400 }));
    if (expectedVersion !== null && typeof expectedVersion !== 'string') return Promise.reject(Object.assign(new Error('The expected version must be a string, or null for a new file.'), { status: 400 }));
    let directory;
    try { directory = packageDirectory(this.root, name); } catch (error) { return Promise.reject(error); }
    return this.#queue(name, file, async () => {
      await readdir(directory).catch(error => { throw error.code === 'ENOENT' ? Object.assign(new Error(`Unknown source package: ${name}.`), { status: 404 }) : error; });
      const path = join(directory, file);
      const current = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const currentVersion = current === null ? null : sourceVersion(current);
      if (currentVersion !== expectedVersion) {
        if (current !== null) this.#notify({ packageName: name, name: file, text: current, version: currentVersion });
        throw Object.assign(new Error(`${name}/${file} changed since it was read.`), { status: 412, version: currentVersion });
      }
      const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, text);
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      const version = sourceVersion(text);
      this.#notify({ packageName: name, name: file, text, version });
      return version;
    });
  }
}
