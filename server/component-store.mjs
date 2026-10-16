import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, filePath, validateManifest } from '../components/manifest.js';
import { checkSize, decode } from '../components/values.js';

export class ComponentStore {
  constructor(directory, catalog) {
    this.directory = directory;
    this.catalog = catalog;
  }

  versionPath(version) {
    if (!/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid component version.');
    return path.join(this.directory, 'versions', version);
  }

  async install({ manifest: input, files }) {
    const manifest = validateManifest(input);
    if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 128) throw new Error('A component requires at most 128 source files.');
    for (const [name, source] of Object.entries(files)) {
      filePath(name);
      if (typeof source !== 'string') throw new Error(`Component file ${name} requires text.`);
    }
    if (!Object.hasOwn(files, manifest.entry)) throw new Error('Component entry file is missing.');
    const record = canonical({ manifest, files });
    const text = JSON.stringify(record);
    checkSize(record, 1024 * 1024);
    const version = createHash('sha256').update(text).digest('hex');
    for (const dependency of manifest.dependencies) await this.source(dependency);
    const parent = path.join(this.directory, 'versions');
    await mkdir(parent, { recursive: true });
    const temporary = await mkdtemp(path.join(this.directory, '.install-'));
    try {
      for (const [name, source] of Object.entries(files)) {
        const destination = path.join(temporary, name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, source, { flag: 'wx' });
      }
      await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify({ version, manifest, files: Object.keys(record.files) }));
      try { await rename(temporary, this.versionPath(version)); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        await this.source(version);
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
    return this.describe(version, manifest);
  }

  describe(version, manifest) {
    return { version, manifest, catalog: this.catalog,
      url: `/components/${this.catalog}/versions/${version}/${manifest.entry}`,
      fileUrl: pathToFileURL(path.join(this.versionPath(version), manifest.entry)).href };
  }

  async source(version) {
    const directory = this.versionPath(version);
    const record = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const manifest = validateManifest(record.manifest);
    const files = Object.fromEntries(await Promise.all(record.files.map(async name => [filePath(name), await readFile(path.join(directory, name), 'utf8')])));
    const digest = createHash('sha256').update(JSON.stringify(canonical({ manifest, files }))).digest('hex');
    if (version !== digest || record.version !== version) throw new Error(`Component source hash differs from version ${version}.`);
    return { ...this.describe(version, manifest), files };
  }

  async list() {
    let entries;
    try { entries = await readdir(path.join(this.directory, 'versions')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return Promise.all(entries.sort().map(async version => {
      const { files, ...description } = await this.source(version);
      return description;
    }));
  }

  async file(version, name) {
    const source = await this.source(version);
    if (!Object.hasOwn(source.files, filePath(name))) throw new Error(`Unknown component file: ${name}.`);
    return { text: source.files[name], path: path.join(this.versionPath(version), name) };
  }

  snapshotPath(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid component snapshot ID.');
    return path.join(this.directory, 'snapshots', id, 'record.json');
  }

  async saveSnapshot({ manifest, files, configuration, state }) {
    decode(configuration);
    if (state !== undefined) decode(state);
    const source = await this.install({ manifest, files });
    const record = canonical({ format: 1, version: source.version, configuration, ...(state === undefined ? {} : { state }) });
    checkSize(record, 1024 * 1024);
    const text = JSON.stringify(record);
    const id = createHash('sha256').update(text).digest('hex');
    await mkdir(path.join(this.directory, 'snapshots'), { recursive: true });
    const temporary = await mkdtemp(path.join(this.directory, '.snapshot-'));
    try {
      await writeFile(path.join(temporary, 'record.json'), text);
      try { await rename(temporary, path.dirname(this.snapshotPath(id))); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        await this.snapshot(id);
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
    return { id, ...record };
  }

  async snapshot(id) {
    const record = JSON.parse(await readFile(this.snapshotPath(id), 'utf8'));
    if (record.format !== 1 || createHash('sha256').update(JSON.stringify(canonical(record))).digest('hex') !== id) throw new Error('Component snapshot hash differs from its ID.');
    await this.source(record.version);
    return { id, ...record };
  }

  async snapshots() {
    let entries;
    try { entries = await readdir(path.join(this.directory, 'snapshots')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return Promise.all(entries.sort().map(id => this.snapshot(id)));
  }
}
