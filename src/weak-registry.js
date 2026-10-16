export class WeakRegistry {
  #entries = new Map();
  #finalizer = new FinalizationRegistry(id => this.#entries.delete(id));

  set(id, value) {
    const previous = this.#entries.get(id);
    if (previous) this.#finalizer.unregister(previous);
    const reference = new WeakRef(value);
    this.#entries.set(id, reference);
    this.#finalizer.register(value, id, reference);
    return this;
  }

  get(id) {
    const reference = this.#entries.get(id);
    const value = reference?.deref();
    if (reference && value === undefined) {
      this.#finalizer.unregister(reference);
      this.#entries.delete(id);
    }
    return value;
  }

  *values() {
    for (const id of this.#entries.keys()) {
      const value = this.get(id);
      if (value !== undefined) yield value;
    }
  }

  get size() {
    let count = 0;
    for (const value of this.values()) count++;
    return count;
  }
}
