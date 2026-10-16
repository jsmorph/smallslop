import { tokenize } from './compiler.js';

const version = "Smalltalk interchangeVersion: '1.0'";
const definitionKeywords = ['named:', 'superclass:', 'indexedInstanceVariables:', 'instanceVariableNames:',
  'classVariableNames:', 'sharedPools:', 'classInstanceVariableNames:'];

function fail(message, offset) {
  throw Object.assign(new SyntaxError(offset === undefined ? message : `${message} (offset ${offset})`), { offset });
}

function quote(text) {
  return `'${text.replaceAll("'", "''")}'`;
}

function names(text) {
  return text.split(/\s+/).filter(Boolean);
}

export function interchangeChunks(text) {
  const chunks = [];
  let current = '';
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '!') { current += text[index]; continue; }
    if (text[index + 1] === '!') { current += '!'; index++; continue; }
    chunks.push({ text: current, offset: start });
    current = '';
    start = index + 1;
  }
  if (current.trim()) fail('The interchange text ends without a closing !', start);
  return chunks;
}

function parseClassDefinition(text, offset) {
  const tokens = tokenize(text).filter(token => token.kind !== 'end');
  const expected = ['name', ...definitionKeywords.flatMap(keyword => ['keyword', keyword === 'indexedInstanceVariables:' ? 'symbol' : 'string'])];
  if (tokens.length !== expected.length || tokens[0].value !== 'Class') fail('Expected Class named: ... classInstanceVariableNames: ...', offset);
  const values = {};
  definitionKeywords.forEach((keyword, index) => {
    const name = tokens[1 + index * 2];
    const value = tokens[2 + index * 2];
    if (name.kind !== 'keyword' || name.value !== keyword || value.kind !== expected[2 + index * 2]) fail(`Expected ${keyword} in the class definition`, offset + name.start);
    values[keyword] = value.value;
  });
  const indexed = values['indexedInstanceVariables:'].name;
  if (!['none', 'object', 'byte'].includes(indexed)) fail('indexedInstanceVariables: must be #none, #object, or #byte', offset);
  return {
    type: 'class', name: values['named:'], superclass: values['superclass:'], indexed,
    slots: names(values['instanceVariableNames:']), classVariables: names(values['classVariableNames:']),
    pools: names(values['sharedPools:']), classSlots: names(values['classInstanceVariableNames:']), annotations: {}, offset,
  };
}

function unquote(text) {
  return text.slice(1, -1).replaceAll("''", "'");
}

export function parseInterchangeElements(text, chunks = interchangeChunks(text)) {
  const elements = [];
  for (let index = 0; index < chunks.length; index++) {
    const { text: raw, offset } = chunks[index];
    const chunk = raw.trim();
    if (!chunk || /^"[^"]*"$/.test(chunk)) continue;
    const annotation = chunk.match(/^Annotation\s+key:\s*('(?:[^']|'')*')\s+value:\s*('(?:[^']|'')*')$/);
    if (annotation) {
      const element = elements.at(-1);
      if (!element) fail('An annotation must follow an element', offset);
      element.annotations[unquote(annotation[1])] = unquote(annotation[2]);
      continue;
    }
    const method = chunk.match(/^([A-Za-z_][A-Za-z_0-9]*)\s+(method|classMethod)$/);
    if (method) {
      const body = chunks[++index];
      if (!body) fail(`${method[1]} ${method[2]} needs a method definition`, offset);
      elements.push({ type: method[2], className: method[1], source: body.text.trim(), annotations: {}, offset: body.offset });
      continue;
    }
    if (/^Class\s+named:/.test(chunk)) { elements.push(parseClassDefinition(chunk, offset)); continue; }
    fail(`Unsupported interchange element: ${chunk.split('\n')[0]}`, offset);
  }
  return elements;
}

export function parseInterchange(text) {
  const chunks = interchangeChunks(text);
  if (chunks[0]?.text.trim().replace(/\s+/g, ' ') !== version) fail(`An interchange file starts with ${version}!`, 0);
  return parseInterchangeElements(text, chunks.slice(1));
}

export function defineClassElement(runtime, element) {
  if (element.indexed !== 'none') throw new Error(`${element.name}: indexed instance variables are not supported.`);
  if (element.classVariables.length || element.pools.length) throw new Error(`${element.name}: class variables and shared pools are not supported.`);
  const superclass = runtime.classes.get(element.superclass);
  if (!superclass) throw new Error(`${element.name}: unknown superclass ${element.superclass}.`);
  const existing = runtime.classes.get(element.name);
  const options = { superclass, slots: element.slots, classSlots: element.classSlots, category: element.annotations.category ?? existing?.category ?? 'Unclassified' };
  if (!existing) return { klass: runtime.defineClass(element.name, options), failures: [] };
  const own = behavior => behavior.slots.slice(behavior.superclass.slots.length).join(' ');
  if (existing.superclass === superclass && own(existing) === options.slots.join(' ')
      && own(existing.metaclass) === options.classSlots.join(' ') && existing.category === options.category) return { klass: existing, failures: [] };
  return { klass: existing, failures: runtime.redefineClass(existing, options) };
}

export function installInterchangeElements(runtime, elements, { beforeMethods } = {}) {
  const result = { classes: [], methods: [], failures: [] };
  const failed = (element, fields) => result.failures.push({ ...fields, ...(element.file ? { file: element.file } : {}) });
  for (const element of elements.filter(item => item.type === 'class')) {
    try {
      const { klass, failures } = defineClassElement(runtime, element);
      result.classes.push(klass.name);
      for (const failure of failures) failed(element, failure);
    } catch (error) {
      failed(element, { className: element.name, message: error.message });
    }
  }
  beforeMethods?.(runtime);
  for (const element of elements.filter(item => item.type !== 'class')) {
    const klass = runtime.classes.get(element.className);
    const owner = element.type === 'classMethod' ? klass?.metaclass : klass;
    try {
      if (!owner) throw new Error(`Unknown class: ${element.className}.`);
      const method = runtime.installSource(owner, element.source, { protocol: element.annotations.category ?? 'unclassified' });
      result.methods.push(`${owner.name}>>${method.selector}`);
    } catch (error) {
      failed(element, { className: element.type === 'classMethod' ? `${element.className} class` : element.className,
        source: element.source, message: error.message });
    }
  }
  return result;
}

export function fileIn(runtime, text) {
  return installInterchangeElements(runtime, parseInterchange(text));
}

export function definitionText({ name, superclass, slots = [], classSlots = [], category }) {
  return `Class named: ${quote(name)}
  superclass: ${quote(superclass)}
  indexedInstanceVariables: #none
  instanceVariableNames: ${quote(slots.join(' '))}
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ${quote(classSlots.join(' '))}!
Annotation key: 'category' value: ${quote(category)}!
`;
}

export function classDefinition(klass) {
  if (!klass.superclass || klass.meta) throw new Error(`${klass.name} has no interchange class definition.`);
  return definitionText({ name: klass.name, superclass: klass.superclass.name, category: klass.category,
    slots: klass.slots.slice(klass.superclass.slots.length),
    classSlots: klass.metaclass.slots.slice(klass.metaclass.superclass.slots.length) });
}

export function fileOut(klass) {
  const parts = [`${version}!\n`, klass.superclass ? classDefinition(klass) : ''];
  for (const [owner, kind] of [[klass, 'method'], [klass.metaclass, 'classMethod']]) {
    for (const method of [...owner.methods.values()].sort((a, b) => a.selector.localeCompare(b.selector))) {
      if (method.format !== 'source') continue;
      parts.push(`\n${klass.name} ${kind}!\n${method.code.source.replaceAll('!', '!!')}!\nAnnotation key: 'category' value: ${quote(method.protocol)}!\n`);
    }
  }
  return parts.join('');
}

export const interchangeVersion = version;
