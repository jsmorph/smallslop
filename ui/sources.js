export async function fetchSources(packages, base = new URL('/api/smalltalk/', location.href)) {
  const entries = await Promise.all(packages.map(async name => {
    const response = await fetch(new URL(name, base), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cannot load the ${name} sources: ${response.status} ${await response.text()}`);
    return [name, await response.json()];
  }));
  return Object.fromEntries(entries);
}
