const textEncoder = new TextEncoder();

export function checkSize(value, maxBytes) {
  const text = JSON.stringify(value);
  if (textEncoder.encode(text).length > maxBytes) throw new Error(`Component message exceeds ${maxBytes} bytes.`);
  return value;
}

export function encode(value, { reference = () => null, maxBytes = 1024 * 1024, maxDepth = 32 } = {}) {
  const ancestors = new Set();
  let allowance = maxBytes;
  function visit(item, path, depth) {
    allowance -= typeof item === 'string' ? textEncoder.encode(item).length : 8;
    if (allowance < 0) throw new Error(`Component message exceeds ${maxBytes} bytes.`);
    if (depth > maxDepth) throw new Error(`Component data exceeds depth ${maxDepth} at ${path}.`);
    if (item === null) return { kind: 'nil' };
    if (item === undefined) return { kind: 'undefined' };
    if (typeof item === 'bigint') return { kind: 'integer', value: String(item) };
    if (typeof item === 'number') return { kind: 'float', value: Object.is(item, -0) ? '-0' : Number.isFinite(item) ? item : String(item) };
    if (typeof item === 'boolean' || typeof item === 'string') return { kind: typeof item, value: item };
    const target = reference(item);
    if (target) return { kind: 'reference', value: target };
    if (item instanceof Uint8Array) {
      allowance -= item.length;
      if (allowance < 0) throw new Error(`Component message exceeds ${maxBytes} bytes.`);
      return { kind: 'bytes', value: [...item] };
    }
    if (typeof item !== 'object') throw new Error(`Unsupported component value at ${path}: ${typeof item}.`);
    if (ancestors.has(item)) throw new Error(`Cyclic component data at ${path}.`);
    const array = Array.isArray(item);
    if (array && item.length > allowance / 8) throw new Error(`Component message exceeds ${maxBytes} bytes.`);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error(`Expected a plain data record at ${path}.`);
    if (Object.getOwnPropertySymbols(item).length) throw new Error(`Symbol fields cannot be copied at ${path}.`);
    ancestors.add(item);
    const fields = Object.getOwnPropertyDescriptors(item);
    if (array && Object.keys(fields).some(name => name !== 'length' && !/^(0|[1-9]\d*)$/.test(name))) throw new Error(`Array properties require a data record at ${path}.`);
    const result = array ? [] : {};
    for (const name of array ? Array.from({ length: item.length }, (_, i) => String(i)) : Object.keys(fields)) {
      const descriptor = fields[name];
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new Error(`Accessor requires an explicit message at ${path}.${name}.`);
      Object.defineProperty(result, name, { value: visit(descriptor?.value, `${path}.${name}`, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(item);
    return { kind: array ? 'array' : 'record', value: result };
  }
  return checkSize(visit(value, '$', 0), maxBytes);
}

export function decode(value, { reference = value => value, maxBytes = 1024 * 1024, maxDepth = 32 } = {}) {
  checkSize(value, maxBytes);
  function visit(item, depth) {
    if (depth > maxDepth) throw new Error(`Component data exceeds depth ${maxDepth}.`);
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Expected an encoded component value.');
    switch (item.kind) {
      case 'nil': return null;
      case 'undefined': return undefined;
      case 'integer': if (typeof item.value === 'string' && /^-?\d+$/.test(item.value)) return BigInt(item.value); break;
      case 'float':
        if (typeof item.value === 'number' && Number.isFinite(item.value)) return item.value;
        if (['-0', 'NaN', 'Infinity', '-Infinity'].includes(item.value)) return Number(item.value);
        break;
      case 'string': case 'boolean': if (typeof item.value === item.kind) return item.value; break;
      case 'bytes':
        if (Array.isArray(item.value) && item.value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(item.value);
        break;
      case 'reference': return reference(validateReference(item.value));
      case 'array': if (Array.isArray(item.value)) return item.value.map(value => visit(value, depth + 1)); break;
      case 'record':
        if (item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
          return Object.fromEntries(Object.entries(item.value).map(([name, value]) => [name, visit(value, depth + 1)]));
        }
        break;
    }
    throw new Error(`Invalid component value: ${item.kind}.`);
  }
  return visit(value, 0);
}

export function validateReference(value) {
  if (!value || ['catalog', 'runtime', 'incarnation', 'id'].some(name => typeof value[name] !== 'string' || !value[name])) {
    throw new Error('An object reference requires catalog, runtime, incarnation, and id.');
  }
  return { catalog: value.catalog, runtime: value.runtime, incarnation: value.incarnation, id: value.id };
}

export function referenceKey(value) {
  return JSON.stringify(validateReference(value));
}

export function errorData(error) {
  return { name: error?.name ?? 'ThrownValue', message: error?.message ?? String(error), stack: error?.stack ?? null,
    ...(error?.outcomeUnknown ? { outcomeUnknown: true } : {}),
    ...(error?.requestId ? { requestId: error.requestId } : {}),
    ...(error?.phase ? { phase: error.phase } : {}),
    ...(error?.phase === 'release' ? { callId: error.callId, result: error.result } : {}),
    ...(error?.component ? { component: validateReference(error.component) } : {}) };
}
