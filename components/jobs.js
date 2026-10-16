import { decode } from './values.js';

export function describeComponentJob(call) {
  const terminal = ['completed', 'cancelled'].includes(call.status) && call.execution !== 'running';
  const cancelled = call.status === 'cancelled';
  const error = cancelled && call.error?.name === 'AbortError' ? null : call.error?.message ?? null;
  const value = call.result ? decode(call.result) : null;
  return {
    id: call.id, kind: 'component', catalogId: call.target.catalog, title: call.job.label,
    status: call.unavailable ? 'unknown' : cancelled ? terminal ? error ? 'error' : 'cancelled' : 'cancelling'
      : error ? 'error' : call.status === 'completed' ? 'done' : call.status === 'paused' ? 'paused' : 'running',
    active: !terminal && !call.unavailable, error, input: call.job.input,
    progress: call.progress, startedAt: call.startedAt, updatedAt: call.updatedAt,
    canCancel: !call.unavailable && (!call.publishing || call.execution === 'failed') && !['completed', 'cancelled'].includes(call.status),
    cancelPath: `/api/component-jobs/${encodeURIComponent(call.id)}/cancel`,
    result: value ? { source: typeof value.source === 'string' ? value.source : null,
      referenceSource: typeof value.referenceSource === 'string' ? value.referenceSource : null,
      filename: typeof value.saved?.filename === 'string' ? value.saved.filename : null } : null,
    call: { id: call.id, target: call.target, version: call.version, selector: call.selector,
      args: call.args, processId: call.processId, execution: call.execution, result: call.result, released: call.released ?? false },
  };
}
