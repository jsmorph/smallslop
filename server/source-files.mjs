import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileOut, installInterchangeElements, parseInterchange } from '../src/interchange.js';

export async function loadSourceDirectory(runtime, directory) {
  const elements = [];
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.st')).sort()) {
    let parsed;
    try { parsed = parseInterchange(await readFile(join(directory, file), 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
    elements.push(...parsed.map(element => ({ ...element, file })));
  }
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
  return installInterchangeElements(runtime, [...ordered, ...elements.filter(item => item.type !== 'class')]);
}

export async function writeClassFile(klass, directory) {
  const path = join(directory, `${klass.name}.st`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, fileOut(klass));
  await rename(temporary, path);
  return path;
}
