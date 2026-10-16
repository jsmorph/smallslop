export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function createPaneView(pane, { container, dispatch, report, nextOrder, focusFallback }) {
  const root = element('section', undefined, 'workspace-pane');
  root.dataset.pane = pane.id;
  root.setAttribute('aria-label', pane.title);
  const header = element('header', undefined, 'pane-heading');
  header.tabIndex = 0;
  header.title = 'Drag to move. Arrow keys move the pane.';
  const title = element('h2', pane.title);
  const association = element('span', pane.association?.label ?? '', 'pane-association');
  association.hidden = !pane.association;
  if (pane.association) {
    root.dataset.association = pane.association.id;
    root.style.setProperty('--association-color', pane.association.color);
  }
  const enlarge = element('button', 'Enlarge');
  enlarge.dataset.action = 'enlarge';
  enlarge.setAttribute('aria-label', `Enlarge ${pane.title}`);
  const close = element('button', 'Close');
  close.dataset.action = 'close';
  close.setAttribute('aria-label', `Close ${pane.title}`);
  header.append(title, association, enlarge, close);
  let body = element('div', undefined, 'pane-body');
  const resize = element('button', undefined, 'pane-resize');
  resize.setAttribute('aria-label', `Resize ${pane.title}`);
  resize.title = 'Drag to resize. Arrow keys resize the pane.';
  root.append(header, body, resize);
  container.append(root);
  const events = new AbortController();
  const on = (node, name, handler) => node.addEventListener(name, handler, { signal: events.signal });
  let detail;
  let contentEvents = new AbortController();
  let mounting = null;
  let mountError = null;
  let disposed = false;
  let visible = false;
  const contentOptions = controller => ({ pane, report,
    on: (node, name, handler) => node.addEventListener(name, handler, { signal: controller.signal }) });
  const showMountError = error => {
    mountError = error;
    const notice = element('p', error.message, 'pane-error');
    notice.setAttribute('role', 'alert');
    body.append(notice);
    report(error);
  };
  const act = request => {
    try { dispatch({ ...request, id: pane.id }); }
    catch (error) { report(error); }
  };
  on(close, 'click', () => act({ op: 'close' }));
  on(enlarge, 'click', () => act({ op: 'enlarge' }));
  on(root, 'pointerdown', () => act({ op: 'focus' }));
  on(root, 'focusin', () => act({ op: 'focus' }));
  on(header, 'dblclick', event => { if (!event.target.closest('button')) act({ op: 'enlarge' }); });
  for (const [handle, action] of [[header, 'move'], [resize, 'resize']]) {
    let start;
    on(handle, 'pointerdown', event => {
      if (event.button !== 0 || (handle === header && event.target.closest('button'))) return;
      if (pane.object.slots.enlarged) return;
      event.preventDefault();
      handle.focus();
      start = { ...pane.object.slots, pointerX: event.clientX, pointerY: event.clientY, pointer: event.pointerId };
      handle.setPointerCapture(event.pointerId);
    });
    on(handle, 'pointermove', event => {
      if (!start || start.pointer !== event.pointerId) return;
      const dx = event.clientX - start.pointerX;
      const dy = event.clientY - start.pointerY;
      act(action === 'move' ? { op: action, x: start.x + dx, y: start.y + dy }
        : { op: action, width: start.width + dx, height: start.height + dy });
    });
    on(handle, 'pointerup', () => { start = null; });
    on(handle, 'pointercancel', () => { start = null; });
    on(handle, 'keydown', event => {
      if (event.target !== handle || pane.object.slots.enlarged) return;
      const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const { x, y, width, height } = pane.object.slots;
      act(action === 'move' ? { op: action, x: x + delta[0], y: y + delta[1] }
        : { op: action, width: width + delta[0], height: height + delta[1] });
    });
  }
  return {
    root, get body() { return body; },
    render() {
      const state = pane.object.slots;
      if (!state.visible && root.contains(root.getRootNode().activeElement)) focusFallback();
      root.hidden = !state.visible;
      Object.assign(root.style, { left: `${state.x}px`, top: `${state.y}px`, width: `${state.width}px`, height: `${state.height}px` });
      title.textContent = state.title;
      enlarge.textContent = state.enlarged ? 'Restore' : 'Enlarge';
      enlarge.setAttribute('aria-label', `${state.enlarged ? 'Restore' : 'Enlarge'} ${state.title}`);
      resize.hidden = state.enlarged;
      if (state.visible && !detail && !mounting && !mountError) {
        try {
          const created = pane.create(body, contentOptions(contentEvents));
          if (created && typeof created.then === 'function') {
            mounting = Promise.resolve(created).then(async value => {
              if (disposed) { await value?.dispose?.(); return; }
              detail = value ?? {};
              await detail.visibility?.(pane.object.slots.visible);
              mounting = null;
            });
            mounting.catch(showMountError);
          } else detail = created ?? {};
        } catch (error) { showMountError(error); throw error; }
      }
      if (visible !== state.visible) {
        visible = state.visible;
        pane.visibility?.(visible);
        const result = detail?.visibility?.(visible);
        if (result && typeof result.then === 'function') {
          const pending = Promise.resolve(result);
          pending.catch(report);
          return pending;
        }
      }
      return mounting;
    },
    ready: async () => { await mounting; if (mountError) throw mountError; return detail; },
    state: () => mountError ? { error: mountError.message } : mounting ? { mounting: true } : detail?.state?.() ?? null,
    refresh: () => detail?.refresh?.(),
    async replace(create, check = () => {}, committed = () => {}) {
      await mounting;
      check();
      const nextBody = element('div', undefined, 'pane-body');
      const nextEvents = new AbortController();
      Object.assign(nextBody.style, { position: 'absolute', visibility: 'hidden', width: `${body.clientWidth}px`, height: `${body.clientHeight}px` });
      root.append(nextBody);
      let nextDetail;
      try {
        nextDetail = await create(nextBody, contentOptions(nextEvents)) ?? {};
        check();
      } catch (error) {
        const failures = [error];
        try { await nextDetail?.dispose?.(); } catch (cleanup) { failures.push(cleanup); }
        nextEvents.abort(); nextBody.remove();
        throw Object.assign(failures.length > 1 ? new AggregateError(failures, 'Candidate view preparation and cleanup failed.') : error,
          { phase: 'preparation' });
      }
      const previous = detail;
      const previousEvents = contentEvents;
      body.replaceWith(nextBody); body = nextBody;
      body.removeAttribute('style');
      detail = nextDetail; contentEvents = nextEvents; mountError = null;
      pane.create = create;
      const failures = [];
      try { committed(); } catch (error) { failures.push(error); }
      previousEvents.abort();
      for (const operation of [() => detail.visibility?.(pane.object.slots.visible), () => previous?.visibility?.(false), () => previous?.dispose?.()]) {
        try { await operation(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw Object.assign(new AggregateError(failures, 'Pane replacement completed with a visibility or cleanup failure.'), { phase: 'committed' });
    },
    focus() {
      if (!pane.object.slots.visible) return;
      root.style.zIndex = String(nextOrder());
      for (const node of container.querySelectorAll('.workspace-pane')) node.classList.toggle('active', node === root);
    },
    dispose() {
      disposed = true;
      const cleanup = detail?.dispose?.();
      const finish = () => { contentEvents.abort(); events.abort(); root.remove(); };
      if (cleanup && typeof cleanup.then === 'function') return Promise.resolve(cleanup).then(finish);
      finish();
    },
  };
}
