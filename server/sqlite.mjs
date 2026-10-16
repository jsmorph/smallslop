import { fork } from 'node:child_process';

export class SqliteConnection {
  constructor(path) {
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.child = fork(new URL('./sqlite-worker.mjs', import.meta.url), [path], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
    let diagnostic = '';
    this.child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-8192); });
    this.child.on('message', ({ id, result, error }) => {
      const request = this.pending.get(id);
      this.pending.delete(id);
      if (request) { if (error) request.reject(new Error(error)); else request.resolve(result); }
    });
    const fail = error => {
      this.closed = true;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.child.on('error', fail);
    this.exited = new Promise(resolve => this.child.once('exit', (code, signal) => {
      fail(new Error(`SQLite connection closed (${signal ?? code}). ${diagnostic}`.trim()));
      resolve();
    }));
  }

  request(op, args = {}) {
    if (this.closed) return Promise.reject(new Error('The SQLite connection is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.send({ id, op, ...args }, error => {
        if (error) { this.pending.delete(id); reject(error); }
      });
    });
  }

  execute(sql, parameters) { return this.request('execute', { sql, parameters }); }
  schema() { return this.request('schema'); }
  async close() {
    this.closed = true;
    this.child.kill('SIGKILL');
    await this.exited;
  }
}
