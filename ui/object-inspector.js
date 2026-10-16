export class InspectorService {
  constructor(world, runtime, snapshot, processId) {
    this.world = world;
    this.runtime = runtime;
    this.id = snapshot.id;
    this.snapshot = snapshot;
    this.processId = processId;
    this.closed = false;
    this.disconnected = false;
    this.closing = null;
  }

  request(request) {
    if (this.closed) throw new Error('The inspector window is closed.');
    if (this.disconnected) throw new Error('The server inspector disconnected. Open a new inspector after reconnecting.');
    const command = { ...request, id: this.id };
    return this.runtime === 'page' ? this.world.inspectors.dispatch(command)
      : this.world.server({ op: 'inspector', ...command });
  }

  state() {
    if (!this.closed && this.runtime === 'page') this.snapshot = this.request({ action: 'state' });
    return { ...this.snapshot, runtime: this.runtime, disconnected: this.disconnected };
  }

  command(action, value) {
    const result = this.request({ action, value });
    const finish = snapshot => {
      this.snapshot = snapshot;
      this.world.touch();
      return this.state();
    };
    return result?.then ? result.then(finish) : finish(result);
  }

  close() {
    if (this.closed) return null;
    if (this.disconnected) { this.closed = true; return null; }
    if (this.closing) return this.closing;
    const result = this.request({ action: 'close', processId: this.processId });
    const finish = () => { this.closed = true; return null; };
    if (!result?.then) return finish();
    this.closing = result.then(finish, error => { this.closing = null; throw error; });
    return this.closing;
  }
}
