import { errorData } from '../components/values.js';

const remoteError = data => Object.assign(new Error(typeof data?.message === 'string' ? data.message : 'The server reported an invalid error.'),
  data && typeof data === 'object' ? data : {});

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
    this.state = null;
  }

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }

  connect() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => this.open());
    socket.addEventListener('message', async event => {
      if (socket !== this.socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'session') {
          this.state = message.state;
          this.session(this.state);
        } else if (message.type === 'status') {
          this.state = { ...this.state, status: message.status, model: message.model };
          this.session(this.state);
        } else if (message.type === 'message') {
          this.state.messages.push(message.message);
          this.session(this.state);
        } else if (message.type === 'command') {
          let reply;
          try { reply = { type: 'commandResult', id: message.id, result: await this.command(message.command) }; }
          catch (error) { reply = { type: 'commandResult', id: message.id, error: errorData(error) }; }
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(reply));
        } else if (message.type === 'reply') {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (pending) {
            if (Object.hasOwn(message, 'error')) pending.reject(remoteError(message.error)); else pending.resolve(message.result);
          } else if (Object.hasOwn(message, 'error')) this.error(remoteError(message.error));
        } else if (message.type === 'error') this.error(remoteError(message.error));
        else throw new Error(`Unknown server message: ${message.type}.`);
      } catch (error) { this.error(error); }
    });
    socket.addEventListener('close', () => {
      const error = new Error('The session connection closed. Reconnect to start a new session.');
      for (const [id, pending] of this.pending) {
        if (pending.socket !== socket) continue;
        this.pending.delete(id);
        pending.reject(error);
      }
      if (socket === this.socket) this.error(error);
    });
  }

  request(type, args = {}) {
    const id = `r${this.nextId++}`;
    const { promise, resolve, reject } = Promise.withResolvers();
    if (!this.connected) {
      reject(new Error('The session connection is closed.'));
      return promise;
    }
    this.pending.set(id, { resolve, reject, socket: this.socket });
    this.socket.send(JSON.stringify({ type, id, ...args }));
    return promise;
  }

  ask(message, context) { return this.request('prompt', { message, context }); }
  interrupt() {
    if (!this.connected) throw new Error('The session connection is closed.');
    this.socket.send(JSON.stringify({ type: 'interrupt' }));
  }
  reset() { return this.request('reset'); }
  server(command) { return this.request('server', { command }); }
  components(request) { return this.request('components', { request }); }
}
