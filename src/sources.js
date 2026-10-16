import { installInterchangeElements, parseInterchange } from './interchange.js';

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
