import { Code, Debugger, Runtime } from '../src/index.js';

export function createRepairDemo() {
  const runtime = new Runtime();
  const klass = runtime.defineClass('RepairExample', { slots: ['visited'] });
  runtime.installSource(klass, 'invoke: block ^block value value');
  const method = runtime.installSource(klass, `run
  | captured |
  visited := true.
  captured := 7.
  ^self invoke: [[self finish: captured]]`);
  const outer = method.code.literals.find(value => value instanceof Code);
  const inner = outer.literals.find(value => value instanceof Code);
  runtime.breakpoint(method, 0, inner);
  const receiver = runtime.newObject(klass);
  const processId = runtime.start(receiver, 'run');
  return { runtime, klass, receiver, processId };
}

export function runRepairDemo() {
  const { runtime, klass, receiver, processId } = createRepairDemo();
  const states = [];
  let state = runtime.run(processId);
  if (state.stop.reason !== 'breakpoint') throw new Error('Expected the nested-block breakpoint.');
  const frame = state.frames[0];
  const captured = frame.scopes.find(scope => Object.hasOwn(scope, 'captured')).captured;
  states.push(`Paused in a nested block with ${state.frames.length} frames; captured = ${captured}.`);
  runtime.setVariable(processId, frame.id, 'captured', 42n);
  states.push('Changed the shared captured binding to 42.');
  state = runtime.run(processId);
  if (state.stop.error?.name !== 'MessageNotUnderstood' || state.stop.error.selector !== 'finish:') {
    throw new Error('Expected a suspended finish: send.');
  }
  states.push(`Suspended at missing finish: with argument ${state.stop.error.arguments[0]}.`);
  runtime.installSource(klass, 'finish: value ^value');
  state = runtime.retry(processId);
  if (state.status !== 'completed' || state.result !== 42n || receiver.slots.visited !== true) {
    throw new Error('Repair did not complete with the captured value.');
  }
  states.push(`Installed finish:, retried the send, and completed with ${state.result}.`);
  return { states, result: state.result };
}

export function runAgentRepairDemo() {
  const { runtime, klass, processId } = createRepairDemo();
  const debugger_ = new Debugger(runtime);
  const send = request => JSON.parse(JSON.stringify(debugger_.dispatch(JSON.parse(JSON.stringify(request)))));
  const paused = send({ op: 'run', processId });
  if (paused.stop.reason !== 'breakpoint') throw new Error('Expected the agent breakpoint.');
  const value = { kind: 'integer', value: '9007199254740993' };
  send({ op: 'setVariable', processId, frameId: paused.frames[0].id, name: 'captured', value });
  const failed = send({ op: 'run', processId });
  if (failed.stop.error?.name !== 'MessageNotUnderstood' || failed.stop.error.arguments[0].value !== value.value) {
    throw new Error('The JSON debugger lost the failed send or its integer argument.');
  }
  send({ op: 'install', className: klass.name, source: 'finish: value ^value' });
  const completed = send({ op: 'retry', processId });
  if (completed.status !== 'completed' || completed.result.kind !== value.kind || completed.result.value !== value.value) {
    throw new Error('The JSON debugger did not complete with the exact integer.');
  }
  return completed.result;
}
