export function filePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.split('/').some(part => !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(part))) {
    throw new Error('Component files require relative paths with letters, digits, dots, underscores, or hyphens.');
  }
  if (value === 'manifest.json') throw new Error('manifest.json belongs to the module store.');
  return value;
}

export function selectorParts(selector, arity) {
  if (!Number.isInteger(arity) || arity < 0 || arity > 16) throw new Error('Message arity must be in 0..16.');
  if (arity === 0 && /^[a-zA-Z][a-zA-Z0-9]*$/.test(selector)) return [selector];
  if (arity === 1 && /^[+*/<>=~&|,@%?!\\-]+$/.test(selector)) return [selector];
  const parts = selector.match(/[a-zA-Z][a-zA-Z0-9]*:/g);
  if (parts?.join('') === selector && parts.length === arity) return parts;
  throw new Error(`Selector ${selector} does not match arity ${arity}.`);
}

export function validateManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A component requires a manifest.');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(input.name)) throw new Error('A component requires a lowercase name.');
  if (!['browser', 'server'].includes(input.target)) throw new Error('Component target must be browser or server.');
  const entry = filePath(input.entry ?? 'index.mjs');
  if (!/\.(mjs|js)$/.test(entry)) throw new Error('Component entry requires a JavaScript module.');
  const factory = input.factory ?? 'create';
  if (!/^[a-zA-Z_$][\w$]*$/.test(factory)) throw new Error('Invalid factory export.');
  const declaration = input.interface;
  if (!declaration || !/^[A-Z][a-zA-Z0-9]*$/.test(declaration.className)) throw new Error('A component requires a Smallslop class name.');
  const messages = Object.fromEntries(Object.entries(declaration.messages ?? {}).map(([selector, message]) => {
    selectorParts(selector, message.arity);
    if (selector.startsWith('componentCall')) throw new Error('The componentCall selector prefix belongs to generated forwarding methods.');
    if (typeof message.method !== 'string' || !message.method || !['data', 'reference'].includes(message.result ?? 'data')) throw new Error(`Invalid message mapping: ${selector}.`);
    if (message.context !== undefined && typeof message.context !== 'boolean') throw new Error(`Invalid call context option: ${selector}.`);
    return [selector, { method: message.method, arity: message.arity, result: message.result ?? 'data', description: String(message.description ?? ''),
      ...(message.context === true ? { context: true } : {}) }];
  }));
  if (Object.keys(messages).length > 128) throw new Error('A component supports at most 128 published messages.');
  const bindings = Object.fromEntries(Object.entries(input.bindings ?? {}).map(([name, required]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || !Array.isArray(required) || required.some(value => typeof value !== 'string')) throw new Error('Bindings map names to required selectors.');
    return [name, [...new Set(required)]];
  }));
  const dependencies = [...new Set(input.dependencies ?? [])].sort();
  if (dependencies.some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error('Dependencies require exact component version IDs.');
  let smallslop;
  if (input.smallslop !== undefined) {
    const { category, methods } = input.smallslop;
    if (typeof category !== 'string' || !category.trim() || !Array.isArray(methods)) throw new Error('Smallslop source requires a category and method records.');
    smallslop = { category, methods: methods.map(method => {
      if (typeof method.source !== 'string' || typeof method.protocol !== 'string') throw new Error('A saved Smallslop method requires source and protocol text.');
      return { source: method.source, protocol: method.protocol };
    }) };
  }
  return { name: input.name, target: input.target, entry, factory, interface: { className: declaration.className, messages }, bindings, dependencies,
    ...(smallslop ? { smallslop } : {}) };
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
