export class ProcessRunner {
  constructor(runtime, { budget = 1000, onChange = () => {} } = {}) {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Runner budget must be a positive integer.');
    this.runtime = runtime;
    this.budget = budget;
    this.onChange = onChange;
    this.observers = new Set();
    this.active = new Set();
    this.queue = new Set();
    this.waiting = new Map();
    this.timer = null;
    this.closed = false;
  }

  follow(id) {
    if (this.closed) throw new Error('The process runner is closed.');
    const process = this.runtime.process(id);
    if (process.status === 'waiting' || this.#runnable(process)) this.active.add(id);
    else this.active.delete(id);
    this.#update(id);
  }

  subscribe(observer) {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  #runnable(process) {
    return process?.status === 'paused' && ['start', 'budget', 'ready'].includes(process.stop.reason);
  }

  #update(id) {
    const process = this.runtime.processes.get(id);
    this.queue.delete(id);
    if (this.active.has(id)) {
      if (this.#runnable(process)) this.queue.add(id);
      else if (process?.status === 'waiting') {
        const completion = this.runtime.whenReady(id);
        if (this.waiting.get(id) !== completion) {
          this.waiting.set(id, completion);
          ProcessRunner.#observe(completion, new WeakRef(this), id);
        }
      } else this.active.delete(id);
    }
    if (this.queue.size && this.timer === null) this.timer = setTimeout(() => this.#tick(), 0);
    this.onChange(id);
    for (const observer of this.observers) observer(id);
  }

  static #observe(completion, reference, id) {
    completion.then(() => {
      const runner = reference.deref();
      if (!runner || runner.closed || runner.waiting.get(id) !== completion) return;
      runner.waiting.delete(id);
      runner.#update(id);
    });
  }

  #tick() {
    this.timer = null;
    const id = this.queue.values().next().value;
    if (id === undefined) return;
    this.queue.delete(id);
    if (this.active.has(id) && this.#runnable(this.runtime.processes.get(id))) {
      this.runtime.resume(id, { budget: this.budget });
    }
    this.#update(id);
  }

  forget(id) {
    this.active.delete(id);
    this.queue.delete(id);
    this.waiting.delete(id);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.active.clear();
    this.queue.clear();
    this.waiting.clear();
    this.observers.clear();
  }
}
