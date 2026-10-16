export async function fetchSources(packages, base = new URL('/api/smalltalk/', location.href)) {
  const entries = await Promise.all(packages.map(async name => {
    const response = await fetch(new URL(name, base), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cannot load the ${name} sources: ${response.status} ${await response.text()}`);
    return [name, await response.json()];
  }));
  return Object.fromEntries(entries);
}

export function sourceWriter(base = new URL('/api/smalltalk/', location.href)) {
  return async (packageName, fileName, text, version) => {
    const response = await fetch(new URL(`${packageName}/${fileName}`, base), {
      method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(version === null ? { 'If-None-Match': '*' } : { 'If-Match': `"${version}"` }) },
    });
    if (!response.ok) throw Object.assign(new Error(`${response.status} ${await response.text()}`), { status: response.status });
    return response.headers.get('ETag').slice(1, -1);
  };
}
