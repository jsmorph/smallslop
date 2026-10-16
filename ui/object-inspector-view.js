function printed(value) {
  if (!value) return '';
  if (value.kind === 'nil') return 'nil';
  if (value.kind === 'string') return `'${value.value.replaceAll("'", "''")}'`;
  if (value.kind === 'object') return `${value.className} @${value.id}`;
  return String(value.value);
}

export function objectInspectorView(widget, body, on, { world, element, perform, command }) {
  const content = element('div', undefined, 'object-inspector');
  const toolbar = element('div', undefined, 'inspector-actions');
  const refreshButton = element('button', 'Refresh');
  const inspectField = element('button', 'Inspect field');
  const inspectClass = element('button', 'Inspect class');
  const browse = element('button', 'Browse class');
  const identity = element('output', undefined, 'inspector-identity');
  toolbar.append(refreshButton, inspectField, inspectClass, browse);
  const panes = element('div', undefined, 'inspector-panes');
  const fields = element('select', undefined, 'inspector-fields');
  fields.size = 8;
  fields.setAttribute('aria-label', 'Object fields');
  const value = element('pre', undefined, 'inspector-value');
  value.setAttribute('aria-label', 'Selected value');
  panes.append(fields, value);
  const paging = element('div', undefined, 'inspector-actions');
  const previous = element('button', 'Previous fields');
  const next = element('button', 'Next fields');
  const range = element('output');
  paging.append(previous, next, range);
  const expression = element('textarea', undefined, 'inspector-expression');
  expression.setAttribute('aria-label', 'Inspector expression');
  expression.spellcheck = false;
  const actions = element('div', undefined, 'inspector-actions');
  const evaluate = element('button', 'Do it');
  const debug = element('button', 'Debug it');
  const inspectResult = element('button', 'Inspect result');
  const debuggerButton = element('button', 'Debugger');
  actions.append(evaluate, debug, inspectResult, debuggerButton);
  const controls = element('div', undefined, 'inspector-actions');
  for (const [action, label] of [['resume', 'Resume'], ['pause', 'Pause'], ['step', 'Step'], ['stepOver', 'Over'], ['stepOut', 'Out'], ['retry', 'Retry'], ['cancel', 'Cancel']]) {
    const button = element('button', label);
    button.dataset.control = action;
    controls.append(button);
    on(button, 'click', () => run(action));
  }
  const result = element('pre', undefined, 'inspector-result');
  result.setAttribute('aria-label', 'Evaluation result');
  const status = element('output', undefined, 'inspector-status');
  status.setAttribute('aria-live', 'polite');
  content.append(identity, toolbar, panes, paging, expression, actions, controls, result, status);
  body.append(content);
  let timer = null;
  let disposed = false;
  let queue = Promise.resolve();
  const run = (action, value) => perform(async () => {
    const task = queue.then(() => command({ op: 'objectInspector', id: widget.id, action, value }));
    queue = task.then(() => undefined, () => undefined);
    await task;
    if (!disposed) render();
  });
  on(refreshButton, 'click', () => run('state'));
  on(fields, 'change', () => run('select', fields.value));
  on(fields, 'dblclick', () => run('openSelected'));
  on(inspectField, 'click', () => run('openSelected'));
  on(inspectClass, 'click', () => run('openClass'));
  on(browse, 'click', () => run('browse'));
  on(previous, 'click', () => run('page', Math.max(0, widget.inspection.state().offset - 100)));
  on(next, 'click', () => run('page', widget.inspection.state().offset + 100));
  on(expression, 'input', () => run('expression', expression.value));
  on(expression, 'keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run('evaluate', 'run'); }
  });
  on(evaluate, 'click', () => run('evaluate', 'run'));
  on(debug, 'click', () => run('evaluate', 'debug'));
  on(inspectResult, 'click', () => run('openResult'));
  on(debuggerButton, 'click', () => run('debugger'));
  const render = () => {
    if (disposed || widget.inspection.closed) return;
    const state = widget.inspection.state();
    identity.textContent = `${state.runtime === 'page' ? 'Page' : 'Server'} · ${printed(state.subject)} · self remains this receiver`;
    const signature = JSON.stringify(state.fields.map(field => [field.key, field.name]));
    if (fields.dataset.signature !== signature) {
      fields.dataset.signature = signature;
      fields.replaceChildren(...state.fields.map(field => {
        const option = element('option', field.name);
        option.value = field.key;
        return option;
      }));
    }
    fields.value = state.selection;
    const selected = state.selected;
    const overview = state.fields.slice(1).map(field => `${field.name}: ${field.value ? printed(field.value) : field.accessor ? '(accessor)' : field.absent ? '(absent)' : `(${field.unsupported})`}`);
    if (state.description.name) overview.unshift(`Class: ${state.description.name}`, `Category: ${state.description.category}`);
    if (state.description.methods) overview.push('', ...state.description.methods.map(method => method.selector));
    if (state.description.hostType) overview.unshift(`Host type: ${state.description.hostType}`);
    value.textContent = selected?.value ? state.selection === 'self'
      ? `${printed(selected.value)}\n\n${overview.join('\n')}`
        : `${selected.value.className ?? ({ string: 'String', integer: 'Integer', float: 'Float', boolean: 'Boolean', nil: 'UndefinedObject' })[selected.value.kind]}\n${printed(selected.value)}`
      : selected?.accessor ? `Accessor: ${selected.get ? 'getter' : ''}${selected.get && selected.set ? ' and ' : ''}${selected.set ? 'setter' : ''}\nEvaluate a message to invoke it.`
        : selected?.absent ? 'Absent array element' : selected?.unsupported ? `Unsupported host value: ${selected.unsupported}` : 'The selected field is absent.';
    inspectField.disabled = !selected?.value;
    browse.disabled = state.runtime !== 'page';
    browse.title = state.runtime === 'page' ? 'Open the class in the System Browser' : 'Use Inspect class to examine this server class';
    paging.hidden = state.total === null || state.total <= 100;
    previous.disabled = state.offset === 0;
    next.disabled = state.total === null || state.offset + 100 >= state.total;
    range.textContent = state.total === null ? '' : `${state.offset + 1}–${Math.min(state.offset + 100, state.total)} of ${state.total}`;
    if (expression.getRootNode().activeElement !== expression && expression.value !== state.expression) expression.value = state.expression;
    const process = state.process;
    const active = process && !['completed', 'cancelled'].includes(process.status);
    evaluate.disabled = debug.disabled = !!active;
    inspectResult.disabled = process?.status !== 'completed';
    debuggerButton.disabled = !process && state.command?.status !== 'paused';
    for (const button of controls.children) {
      const action = button.dataset.control;
      button.disabled = action === 'cancel' || action === 'pause' ? !active
        : action === 'retry' ? process?.stop?.reason !== 'error'
          : process?.status !== 'paused' || process?.stop?.reason === 'error';
    }
    result.textContent = process?.status === 'completed' ? printed(process.result) : '';
    result.hidden = process?.status !== 'completed';
    const failed = state.command?.stop?.reason === 'error' ? state.command : process?.stop?.reason === 'error' ? process : null;
    status.textContent = state.disconnected ? 'Server disconnected. Values show the last inspection.' : failed ? `${state.runtime} process ${failed.id}: ${failed.stop.error.message}`
      : process ? `${state.runtime} process ${process.id}: ${process.status}${process.stop?.reason ? ` / ${process.stop.reason}` : ''}` : 'Ctrl+Enter evaluates the expression.';
    status.classList.toggle('inspector-error', !!failed);
    if (state.disconnected) {
      for (const button of content.querySelectorAll('button')) button.disabled = true;
      fields.disabled = true;
      expression.readOnly = true;
    }
    clearTimeout(timer);
    if (!state.disconnected && state.runtime === 'server' && (process?.status === 'waiting' || ['budget', 'ready', 'start'].includes(process?.stop?.reason))) {
      timer = setTimeout(() => run('state'), 150);
    }
  };
  return { render, refresh: render, dispose() { disposed = true; clearTimeout(timer); } };
}
