export class ComponentClient {
  constructor(request) { this.request = request; }

  async submit(request) {
    const { id } = await this.request({ op: 'requests.reserve' });
    try { return await this.request({ op: 'requests.submit', id, request }); }
    catch (error) { error.requestId = id; throw error; }
  }

  async run(request) {
    let state = await this.submit(request);
    try {
      while (state.status === 'running') state = await this.request({ op: 'requests.wait', id: state.id, revision: state.revision });
      if (state.error) throw Object.assign(new Error(state.error.message), state.error, { outcomeUnknown: state.status === 'unknown' });
      return state.result;
    } catch (error) { error.requestId = state.id; throw error; }
  }
}
