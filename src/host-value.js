export class HostValue {
  constructor(runtime, value) {
    this.runtime = runtime;
    this.value = value;
    Object.freeze(this);
  }
}

export class HostOperation {
  constructor(promise, { cancel = null } = {}) {
    if (!promise || typeof promise.then !== 'function') throw new Error('A host operation requires a promise.');
    if (cancel !== null && typeof cancel !== 'function') throw new Error('A host cancellation handler must be a function.');
    this.promise = promise;
    this.cancel = cancel;
  }
}
