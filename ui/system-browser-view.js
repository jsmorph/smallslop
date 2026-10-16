export function systemBrowserView(widget, body, on, { world, element, perform, command }) {
  const root = element('div', undefined, 'system-browser');
  const panes = element('div', undefined, 'browser-panes');
  const lists = {};
  const act = (action, value, extra = {}) => command({ op: 'browse', id: widget.id, action, value, ...extra });
  for (const [name, label] of [['category', 'Category'], ['class', 'Class'], ['protocol', 'Protocol'], ['method', 'Method']]) {
    const pane = element('div', undefined, `browser-pane browser-${name}`);
    const heading = element('label', label);
    const list = element('select');
    list.size = 9;
    list.setAttribute('aria-label', `Browser ${label.toLowerCase()}`);
    heading.append(list);
    pane.append(heading);
    panes.append(pane);
    lists[name] = list;
    on(list, 'change', () => perform(() => act(name, list.value || null)));
  }
  const sides = element('div', undefined, 'browser-sides');
  const instance = element('button', 'Instance');
  const classSide = element('button', 'Class');
  on(instance, 'click', () => perform(() => act('side', 'instance')));
  on(classSide, 'click', () => perform(() => act('side', 'class')));
  sides.append(instance, classSide);
  panes.querySelector('.browser-class').append(sides);

  const actions = element('div', undefined, 'browser-actions');
  const searches = {};
  for (const name of ['senders', 'implementors', 'inheritance', 'hierarchy', 'variables']) {
    const button = element('button', name[0].toUpperCase() + name.slice(1));
    on(button, 'click', () => perform(() => act('find', name)));
    searches[name] = button;
    actions.append(button);
  }
  const breakpoint = element('button', 'Break at entry');
  on(breakpoint, 'click', () => perform(() => act('breakpoint')));
  actions.append(breakpoint);

  const results = element('section', undefined, 'browser-results');
  const resultHeading = element('div', undefined, 'browser-result-heading');
  const resultLabel = element('output');
  const closeResults = element('button', 'Close results');
  on(closeResults, 'click', () => perform(() => act('clearResults')));
  resultHeading.append(resultLabel, closeResults);
  const resultList = element('div', undefined, 'browser-result-list');
  resultList.setAttribute('aria-label', 'Browser search results');
  on(resultList, 'click', event => {
    const button = event.target.closest('button[data-class]');
    if (button) perform(() => act('reveal', undefined, { className: button.dataset.class, selector: button.dataset.selector }));
  });
  results.append(resultHeading, resultList);

  const shared = element('p', 'Class behavior is shared by all classes. Edits apply to Class.', 'browser-shared');
  const editor = element('textarea', undefined, 'browser-source');
  editor.setAttribute('aria-label', 'Browser source');
  editor.spellcheck = false;
  editor.autocapitalize = 'off';
  on(editor, 'input', () => perform(() => act('source', editor.value)));
  on(editor, 'keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['s', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (!accept.disabled) perform(() => act('accept'));
    }
  });

  const editing = element('div', undefined, 'browser-editing');
  const newMethod = element('button', 'New method');
  const accept = element('button', 'Accept');
  const revert = element('button', 'Revert');
  const protocolLabel = element('label', 'Protocol');
  const protocol = element('input');
  protocol.setAttribute('aria-label', 'Method protocol');
  protocolLabel.append(protocol);
  on(newMethod, 'click', () => perform(() => act('new')));
  on(accept, 'click', () => perform(() => act('accept')));
  on(revert, 'click', () => perform(() => act('revert')));
  on(protocol, 'input', () => perform(() => act('methodProtocol', protocol.value)));
  editing.append(newMethod, accept, revert, protocolLabel);
  const status = element('output', undefined, 'browser-status');
  status.setAttribute('aria-label', 'Browser status');
  status.setAttribute('aria-live', 'polite');
  root.append(panes, actions, results, shared, editor, editing, status);
  body.append(root);

  const fill = (list, items, selected, placeholder) => {
    const options = placeholder ? [{ value: '', label: placeholder }, ...items] : items;
    const key = JSON.stringify(options);
    if (list.dataset.options !== key) {
      list.replaceChildren(...options.map(({ value, label }) => {
        const option = element('option', label);
        option.value = value;
        return option;
      }));
      list.dataset.options = key;
    }
    list.value = selected ?? '';
  };
  let resultKey = null;
  const render = () => {
    const state = widget.browser.state();
    fill(lists.category, state.categories.map(name => ({ value: name, label: name })), state.category, '-- all --');
    const names = new Set(state.classes.map(klass => klass.name));
    const classOptions = [];
    const visit = (klass, depth) => {
      classOptions.push({ value: klass.name, label: `${'\u00a0\u00a0'.repeat(depth)}${klass.name}` });
      for (const child of state.classes.filter(child => child.superclass === klass.name)) visit(child, depth + 1);
    };
    for (const klass of state.classes.filter(klass => !names.has(klass.superclass))) visit(klass, 0);
    fill(lists.class, classOptions, state.className);
    fill(lists.protocol, state.protocols.map(name => ({ value: name, label: name })), state.protocol, '-- all --');
    fill(lists.method, state.methods.map(method => ({ value: method.selector, label: method.selector })), state.selector);
    instance.setAttribute('aria-pressed', String(state.side === 'instance'));
    classSide.setAttribute('aria-pressed', String(state.side === 'class'));
    lists.protocol.disabled = lists.method.disabled = instance.disabled = classSide.disabled = !state.className;
    shared.hidden = state.side !== 'class';
    const ownSlots = state.slots.filter(name => !state.inheritedSlots.includes(name));
    const source = state.methodId || state.creating ? state.source : state.owner
      ? `${state.owner}\n\nSuperclass: ${state.superclass ?? 'none'}\nInstance slots: ${ownSlots.join(' ') || 'none'}\nInherited slots: ${state.inheritedSlots.join(' ') || 'none'}`
      : 'Select a class to browse its methods.';
    if (editor.value !== source) editor.value = source;
    editor.readOnly = !state.editable;
    if (protocol.value !== state.draftProtocol) protocol.value = state.draftProtocol;
    protocol.disabled = !state.editable;
    newMethod.disabled = !state.className;
    accept.disabled = !state.editable || !state.dirty || state.conflict;
    revert.disabled = !state.dirty && !state.conflict && !state.creating;
    breakpoint.disabled = !state.methodId || state.format === 'primitive';
    breakpoint.textContent = state.breakpoints.length ? 'Clear entry break' : 'Break at entry';
    breakpoint.setAttribute('aria-pressed', String(state.breakpoints.length > 0));
    for (const [kind, button] of Object.entries(searches)) button.disabled = ['hierarchy', 'variables'].includes(kind) ? !state.className : !state.selector;
    results.hidden = !state.query;
    const nextKey = JSON.stringify([state.query, state.results]);
    if (resultKey !== nextKey) {
      resultLabel.textContent = `${state.query ?? ''}: ${state.results.length} results`;
      resultList.replaceChildren(...state.results.map(result => {
        const button = element('button', `${'  '.repeat(result.depth ?? 0)}${result.label ?? `${result.className}${result.selector ? ` >> ${result.selector}` : ''}`}`);
        button.dataset.class = result.className;
        if (result.selector) button.dataset.selector = result.selector;
        return button;
      }));
      resultKey = nextKey;
    }
    const format = { source: 'Smallslop source', bytecode: 'Bytecode', primitive: 'JavaScript primitive' }[state.format];
    const error = world.runtime.processes.get(widget.last)?.stop;
    status.textContent = error?.reason === 'error' ? error.error.message
      : state.conflict ? `Version ${state.currentMethodId} replaced version ${state.methodId}. Draft retained. Revert loads the current version.`
        : [state.owner, state.selector, format ?? (state.creating ? 'New method' : 'Class definition'),
          state.methodId ? `version ${state.methodId}` : '', state.dirty ? 'Unsaved changes' : state.message].filter(Boolean).join(' · ');
    status.classList.toggle('browser-error', state.conflict || error?.reason === 'error');
    root.closest('.window, .workspace-pane').querySelector('h2').textContent = `System Browser${state.className ? `: ${state.className}` : ''}${state.dirty ? ' *' : ''}`;
  };
  return { render, refresh: render };
}
