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

const writes = new Map();

export function writeSourceFile(root, name, file, text, expectedVersion) {
  const key = join(root, name, file);
  const previous = writes.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => write(root, name, file, text, expectedVersion));
  writes.set(key, next);
  const clear = () => { if (writes.get(key) === next) writes.delete(key); };
  next.then(clear, clear);
  return next;
}

async function write(root, name, file, text, expectedVersion) {
  if (!filePattern.test(file)) throw Object.assign(new Error(`Invalid source file name: ${file}.`), { status: 400 });
  if (typeof text !== 'string') throw Object.assign(new Error('Source text must be a string.'), { status: 400 });
  const directory = packageDirectory(root, name);
  await readdir(directory).catch(error => { throw error.code === 'ENOENT' ? Object.assign(new Error(`Unknown source package: ${name}.`), { status: 404 }) : error; });
  const path = join(directory, file);
  const current = await readFile(path, 'utf8').then(sourceVersion, error => { if (error.code === 'ENOENT') return null; throw error; });
  if (current !== expectedVersion) {
    throw Object.assign(new Error(`${name}/${file} changed since it was read.`), { status: 412, version: current });
  }
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return sourceVersion(text);
}
