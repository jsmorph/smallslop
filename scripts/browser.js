import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const files = new Map();
for (const directory of ['src', 'examples']) {
  const base = new URL(`../${directory}/`, import.meta.url);
  for (const name of await readdir(base)) {
    if (/\.(js|html)$/.test(name)) files.set(`/${directory}/${name}`, await readFile(new URL(name, base)));
  }
}
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') {
    response.writeHead(302, { Location: '/examples/index.html' });
    response.end();
    return;
  }
  const file = files.get(pathname);
  response.writeHead(file ? 200 : 404, {
    'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
  });
  response.end(file ?? 'Not found');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const url = `http://127.0.0.1:${server.address().port}/`;

if (process.argv.includes('--serve')) {
  console.log(`Smallslop example: ${url}`);
} else {
  let profile;
  try {
    profile = await mkdtemp(join(tmpdir(), 'smallslop-chromium-'));
    for (const path of ['examples/repair.html', 'examples/index.html?test']) {
      const { stdout, stderr } = await promisify(execFile)(process.env.CHROMIUM ?? 'chromium', [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        `--user-data-dir=${profile}`, '--dump-dom', '--virtual-time-budget=15000', '--timeout=20000', `${url}${path}`,
      ], { timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
      if (!stdout.includes('data-result="passed"') || stdout.includes('data-result="failed"')) {
        const report = stdout.match(/<pre id="browser-test-report"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? stdout;
        throw new Error(`Browser example failed: ${path}\n${report}\n${stderr}`);
      }
    }
    console.log('Chromium passed the repair examples and interactive counter, debugger, async, and disposal tests.');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (profile) await rm(profile, { recursive: true, force: true });
  }
}
