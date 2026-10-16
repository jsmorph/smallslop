export function encode(value) {
  if (typeof value === 'bigint') return { kind: 'integer', value: String(value) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { kind: 'float', value: String(value) };
  if (value instanceof Uint8Array) return { kind: 'bytes', value: [...value] };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  return value;
}

export function parameter(value) {
  if (value instanceof Uint8Array) return value;
  if (value === null || ['string', 'bigint', 'number'].includes(typeof value)) return value;
  if (value?.kind === 'nil') return null;
  if (value?.kind === 'string' && typeof value.value === 'string') return value.value;
  if (value?.kind === 'float' && typeof value.value === 'number') return value.value;
  if (value?.kind === 'integer' && typeof value.value === 'string' && /^-?\d+$/.test(value.value)) return BigInt(value.value);
  if (value?.kind === 'float' && ['Infinity', '-Infinity'].includes(value.value)) return Number(value.value);
  if (value?.kind === 'bytes' && Array.isArray(value.value) && value.value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(value.value);
  throw new Error(`Unsupported SQL value type: ${value?.kind ?? typeof value}. Use null, text, numbers, or their Smallslop encodings, or encoded bytes.`);
}

export function parameters(value = []) {
  if (Array.isArray(value)) return value.map(parameter);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parameter(item)]));
  throw new Error('SQL parameters require an array or named parameter object.');
}
