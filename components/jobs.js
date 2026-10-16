export function describeComponentJob(call) {
  const terminal = ['completed', 'cancelled'].includes(call.status) && call.execution !== 'running';
  const cancelled = call.status === 'cancelled';
  const error = cancelled && call.error?.name === 'AbortError' ? null : call.error?.message ?? null;
  return {
    id: call.id, kind: 'component', namespace: call.target.namespace, title: call.job.label,
    status: call.unavailable ? 'unknown' : cancelled ? terminal ? error ? 'error' : 'cancelled' : 'cancelling'
      : error ? 'error' : call.status === 'completed' ? 'done' : call.status === 'paused' ? 'paused' : 'running',
    active: !terminal && !call.unavailable, error, input: call.job.input,
    progress: call.progress, startedAt: call.startedAt, updatedAt: call.updatedAt,
    canCancel: !call.unavailable && (!call.publishing || call.execution === 'failed') && !['completed', 'cancelled'].includes(call.status),
    call: { id: call.id, target: call.target, version: call.version, selector: call.selector,
      args: call.args, processId: call.processId, execution: call.execution, result: call.result, released: call.released ?? false },
  };
}
