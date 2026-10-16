import { statfs } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export function create({ path }) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Disk usage requires an absolute path.');
  return {
    async usage() {
      const value = await statfs(path, { bigint: true });
      const totalBytes = value.blocks * value.bsize;
      const freeBytes = value.bfree * value.bsize;
      return { path, observedAt: new Date().toISOString(), totalBytes, freeBytes,
        usedBytes: totalBytes - freeBytes, availableBytes: value.bavail * value.bsize };
    },
  };
}
