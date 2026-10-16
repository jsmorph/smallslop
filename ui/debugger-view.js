export function debuggerView(widget, body, on, { world, element, perform, command }) {
  const content = element('div', undefined, 'inspector');
  const realm = element('select');
  realm.setAttribute('aria-label', 'Inspector runtime');
  for (const label of world.server ? ['Page', 'Server'] : ['Page']) { const option = element('option', label); option.value = label; realm.append(option); }
  if (widget.inspection) {
    realm.value = widget.inspection.runtime === 'server' ? 'Server' : 'Page';
    realm.disabled = true;
  }
  const refreshButton = element('button', 'Refresh');
  const realmRow = element('div', undefined, 'row');
  realmRow.append(realm, refreshButton);
  const request = element('textarea');
  request.setAttribute('aria-label', 'JSON command');
  request.value = widget.inspection ? JSON.stringify({ op: 'debug', request: { op: 'inspect', processId: widget.inspection.processId } }) : '{"op":"state"}';
  const execute = element('button', 'Execute JSON');
  const result = element('pre', '', 'result');
  result.setAttribute('aria-label', 'Inspection result');
  const methods = element('select');
  methods.setAttribute('aria-label', 'Method');
  const source = element('textarea', undefined, 'source');
  source.setAttribute('aria-label', 'Method source');
  const install = element('button', 'Install method');
  const breakpoint = element('button', 'Break at entry');
  const clear = element('button', 'Clear breakpoints');
  const methodRow = element('div', undefined, 'row');
  methodRow.append(install, breakpoint, clear);
  const process = element('select');
  process.setAttribute('aria-label', 'Process');
  const inspect = element('button', 'Inspect process');
  const processRow = element('div', undefined, 'row');
  processRow.append(process, inspect);
  const controlRow = element('div', undefined, 'row');
  const dispatch = value => widget.inspection && value.op === 'debug'
    ? widget.inspection.request({ action: 'debug', request: value.request })
    : realm.value === 'Server' ? world.server(value) : command(value);
  const show = value => { result.textContent = JSON.stringify(value, null, 2); return value; };
  const run = async value => { const response = await dispatch(value); show(response); await reload(); return response; };
  for (const [op, label] of [['pause', 'Pause'], ['resume', 'Resume'], ['step', 'Step'], ['stepOver', 'Over'], ['stepOut', 'Out'], ['retry', 'Retry'], ['cancel', 'Cancel']]) {
    const button = element('button', label);
    on(button, 'click', () => perform(() => run({ op: 'debug', request: { op, processId: Number(process.value) } })));
    controlRow.append(button);
  }
  let entries = [];
  let loading = false;
  const load = () => {
    const current = entries.find(entry => String(entry.id) === methods.value);
    source.value = current?.source ?? '';
  };
  const processOptions = values => {
    const selected = process.value || String(widget.inspection?.processId ?? '');
    process.replaceChildren(...values.map(item => {
      const option = element('option', `${item.id}: ${item.status} / ${item.stop?.reason ?? ''}`);
      option.value = String(item.id);
      return option;
    }));
    if (values.some(item => String(item.id) === selected)) process.value = selected;
  };
  const reload = async (preserveDraft = false) => {
    if (loading) return;
    loading = true;
    try {
      const previous = entries.find(entry => String(entry.id) === methods.value);
      const draft = preserveDraft && source.value !== previous?.source ? source.value : null;
      entries = realm.value === 'Server'
        ? (await world.server({ op: 'debug', request: { op: 'methods' } })).filter(entry => entry.format === 'source')
        : world.dispatch({ op: 'methods' });
      methods.replaceChildren(...entries.map(entry => { const option = element('option', `${entry.className} ${entry.selector}`); option.value = String(entry.id); return option; }));
      const current = entries.find(entry => entry.className === previous?.className && entry.selector === previous?.selector);
      if (current) methods.value = String(current.id);
      load();
      if (draft !== null) source.value = draft;
      processOptions(realm.value === 'Server' ? (await world.server({ op: 'state' })).processes : [...world.runtime.processes.values()]);
    } finally { loading = false; }
  };
  on(methods, 'change', load);
  on(realm, 'change', () => perform(() => { entries = []; request.value = '{"op":"state"}'; return reload(); }));
  on(refreshButton, 'click', () => perform(() => reload(true)));
  on(install, 'click', () => perform(async () => {
    const entry = entries.find(entry => String(entry.id) === methods.value);
    await run({ op: 'debug', request: { op: 'install', className: entry.className, source: source.value, expectedMethodId: entry.id } });
  }));
  on(breakpoint, 'click', () => perform(() => run({ op: 'debug', request: { op: 'breakpoint', methodId: Number(methods.value) } })));
  on(clear, 'click', () => perform(async () => {
    const ids = realm.value === 'Server' ? (await world.server({ op: 'state' })).breakpoints : [...world.runtime.breakpoints.keys()];
    for (const id of ids) await dispatch({ op: 'debug', request: { op: 'clearBreakpoint', id } });
    show({ cleared: true });
  }));
  on(execute, 'click', () => perform(() => run(JSON.parse(request.value))));
  on(inspect, 'click', () => perform(() => run({ op: 'debug', request: { op: 'inspect', processId: Number(process.value) } })));
  content.append(realmRow, element('p', 'Processes', 'section-label'), processRow, controlRow,
    element('p', 'Methods', 'section-label'), methods, source, methodRow,
    element('p', 'Runtime commands', 'section-label'), request, execute, result);
  body.append(content);
  perform(async () => {
    await reload();
    if (widget.inspection) show(await dispatch({ op: 'debug', request: { op: 'inspect', processId: widget.inspection.processId } }));
  });
  const refresh = () => {
    if (realm.value === 'Server' || loading) return;
    if (world.dispatch({ op: 'methods' }).some((entry, index) => entry.id !== entries[index]?.id)) perform(() => reload(true));
    processOptions([...world.runtime.processes.values()]);
  };
  return { refresh, render: refresh, async selectProcess(id) {
    realm.value = 'Page';
    processOptions([...world.runtime.processes.values()]);
    process.value = String(id);
    if (process.value !== String(id)) throw new Error(`Process ${id} is unavailable.`);
    return run({ op: 'debug', request: { op: 'inspect', processId: id } });
  } };
}

