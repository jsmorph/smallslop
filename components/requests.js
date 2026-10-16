import { canonical } from './manifest.js';
import { checkSize, errorData } from './values.js';

export class ComponentRequests {
  constructor({ maxActive, maxCompleted, incarnation = crypto.randomUUID() }) {
    if (![maxActive, maxCompleted].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Request limits must be positive integers.');
    this.maxActive = maxActive;
    this.maxCompleted = maxCompleted;
    this.incarnation = incarnation;
    this.nextId = 1;
    this.records = new Map();
  }

  reserve() {
    this.trim();
    const reserved = [...this.records.values()].filter(record => record.status === 'reserved');
    if (reserved.length >= this.maxCompleted) this.remove(reserved[0]);
    const id = `${this.incarnation}:${this.nextId++}`;
    this.records.set(id, { id, status: 'reserved', revision: 0, waiters: new Set(), request: null, result: null, error: null, progress: null });
    return { id };
  }

  get(id) {
    const prefix = `${this.incarnation}:`;
    if (typeof id !== 'string' || !id.startsWith(prefix)) throw new Error('Request belongs to an unavailable server incarnation.');
    const sequence = Number(id.slice(prefix.length));
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= this.nextId || `${prefix}${sequence}` !== id) throw new Error('Unknown component request.');
    const record = this.records.get(id);
    if (!record) throw new Error('Component request expired. Reserve a new request only for an explicit new invocation.');
    return record;
  }

  submit(id, request, execute) {
    const record = this.get(id);
    const text = JSON.stringify(canonical(checkSize(request, 1024 * 1024)));
    if (record.status !== 'reserved') {
      if (record.text !== text) throw new Error('Request ID was already used with different arguments.');
      return this.inspect(id);
    }
    if ([...this.records.values()].filter(record => record.status === 'running').length >= this.maxActive) throw new Error(`Component requests reached the active limit of ${this.maxActive}.`);
    record.text = text;
    record.request = JSON.parse(text);
    record.status = 'running';
    this.notify(record);
    setTimeout(() => {
      Promise.resolve().then(() => execute(record.request, id, progress => {
        record.progress = progress; this.notify(record);
      })).then(result => {
        record.result = checkSize(result ?? null, 1024 * 1024);
        record.status = 'completed'; this.notify(record); this.trim();
      }).catch(error => {
        record.error = errorData(error); record.status = error.outcomeUnknown ? 'unknown' : 'failed';
        this.notify(record); this.trim();
      });
    }, 0);
    return this.inspect(id);
  }

  inspect(id) {
    const { status, revision, request, result, error, progress } = this.get(id);
    return { id, status, revision, request, result, error, progress };
  }

  notify(record) {
    record.revision++;
    for (const finish of record.waiters) finish(this.inspect(record.id));
    record.waiters.clear();
  }

  wait(id, revision, { signal, timeout = 25_000 } = {}) {
    const record = this.get(id);
    if (record.revision !== revision || ['completed', 'failed', 'unknown'].includes(record.status)) return Promise.resolve(this.inspect(id));
    return new Promise((resolve, reject) => {
      const finish = (state, error) => {
        clearTimeout(timer); record.waiters.delete(finish); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(state);
      };
      const abort = () => { clearTimeout(timer); record.waiters.delete(finish); reject(signal.reason); };
      const timer = setTimeout(() => finish(this.inspect(id)), timeout);
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      record.waiters.add(finish);
    });
  }

  release(id) {
    const record = this.get(id);
    if (record.status === 'running') throw new Error('A running request must finish before release.');
    this.remove(record);
    return { released: id };
  }

  trim() {
    const terminal = [...this.records.values()].filter(record => ['completed', 'failed', 'unknown'].includes(record.status));
    for (const record of terminal.slice(0, Math.max(0, terminal.length - this.maxCompleted))) this.remove(record);
  }

  remove(record) {
    for (const finish of record.waiters) finish(null, new Error('Component request expired.'));
    this.records.delete(record.id);
  }
}
