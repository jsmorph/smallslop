export class CdpConnection {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.webSocket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.webSocket.addEventListener('open', resolve, { once: true });
      this.webSocket.addEventListener('error', event => reject(event.error || new Error('Debugger connection failed.')), { once: true });
    });
    this.webSocket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data.toString()); }
      catch (error) { this.fail(new Error(`Invalid debugger response: ${error.message}`)); return; }
      if (typeof message.id !== 'number') {
        for (const listener of this.listeners) listener(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.webSocket.addEventListener('close', () => this.fail(new Error('Debugger connection closed.')));
  }

  fail(error) {
    this.error = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'Connection.error', params: { message: error.message } });
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async send(method, params = {}, sessionId, timeoutMs = 0) {
    await this.ready;
    if (this.error) throw this.error;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => { this.pending.delete(id); reject(new Error(`Debugger command ${method} timed out.`)); }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timer });
      this.webSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async close() {
    if (this.webSocket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise(resolve => this.webSocket.addEventListener('close', resolve, { once: true }));
    this.webSocket.close();
    await closed;
    this.listeners.clear();
  }
}
