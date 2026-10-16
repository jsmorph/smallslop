export class SessionConnection {
  constructor({ command, session, error, open = () => {}, url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/session` }) {
    this.command = command;
    this.session = session;
    this.error = error;
    this.open = open;
    this.url = url;
    this.pending = new Map();
    this.nextId = 1;
    this.socket = null;
  }

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }

  connect() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => this.open());
    socket.addEventListener('message', async event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'session') this.session(message.state);
        else if (message.type === 'command') {
          try { this.send({ type: 'commandResult', id: message.id, result: await this.command(message.command) }); }
          catch (error) { this.send({ type: 'commandResult', id: message.id, error: error.message }); }
        } else if (message.type === 'reply') {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (pending) {
            if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
          } else if (message.error) this.error(new Error(message.error));
        } else if (message.type === 'error') this.error(new Error(message.error));
        else throw new Error(`Unknown server message: ${message.type}.`);
      } catch (error) { this.error(error); }
    });
    socket.addEventListener('close', () => {
      const error = new Error('The agent server disconnected. Reconnect to start a new conversation.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.error(error);
    });
    socket.addEventListener('error', () => this.error(new Error('The agent connection failed.')));
  }

  send(message) {
    if (!this.connected) throw new Error('The agent server is disconnected.');
    this.socket.send(JSON.stringify(message));
  }

  request(type, args = {}) {
    const id = `r${this.nextId++}`;
    const { promise, resolve, reject } = Promise.withResolvers();
    this.pending.set(id, { resolve, reject });
    try { this.send({ type, id, ...args }); }
    catch (error) { this.pending.delete(id); reject(error); }
    return promise;
  }

  ask(message, context) { return this.request('prompt', { message, context }); }
  interrupt() { this.send({ type: 'interrupt' }); }
  reset() { return this.request('reset'); }
  server(command) { return this.request('server', { command }); }
  components(request) { return this.request('components', { request }); }
}
