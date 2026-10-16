import { PaneWorld } from './panes.js';
import { createPaneView, element } from './pane-view.js';
import { createPaneSelector } from './pane-selector.js';
import { SourceStore } from './sources.js';

export function createWorkspace({ container, toolbar, definitions, sources, storage, storageKey, onChange = () => {} }) {
  const events = new AbortController();
  const on = (node, type, handler) => node.addEventListener(type, handler, { signal: events.signal });
  const paneButton = element('button', 'Panes');
  paneButton.dataset.action = 'open-panes';
  const resetButton = element('button', 'Reset arrangement');
  const notice = element('button', '', 'workspace-notice');
  notice.hidden = true;
  notice.setAttribute('aria-live', 'polite');
  toolbar.append(paneButton, resetButton, notice);
  const activity = [];
  const reported = new WeakSet();
  let order = 0;
  let saveTimer;
  let ready = false;
  let disposed = false;
  const report = error => {
    if (error && typeof error === 'object') {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const entry = { time: new Date().toISOString(), message: error.message ?? String(error) };
    activity.unshift(entry);
    if (activity.length > 100) activity.pop();
    notice.hidden = false;
    notice.textContent = `Activity: ${activity.length} ${activity.length === 1 ? 'error' : 'errors'}`;
    notice.title = entry.message;
    world.panes.get('activity')?.view.refresh();
  };
  const save = () => {
    if (disposed || !ready) return;
    try { storage?.setItem(storageKey, JSON.stringify(world.layout())); }
    catch (error) { report(new Error(`Cannot save the pane arrangement: ${error.message}`)); }
  };
  const changed = () => {
    if (!ready) return;
    for (const pane of world.panes.values()) pane.view.root?.classList.toggle('active', pane.id === world.focused);
    world.panes.get('panes')?.view.refresh();
    onChange();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 150);
  };
  const dispatch = request => world.dispatch(request);
  const act = request => { try { return dispatch(request); } catch (error) { report(error); } };
  const world = new PaneWorld({
    sources,
    extent: () => ({ width: container.clientWidth, height: container.clientHeight }), changed, failed: report,
    createView: pane => createPaneView(pane, { container: pane.container ?? container, dispatch, report,
      nextOrder: () => ++order, focusFallback: () => paneButton.focus() }),
  });
  world.register({ id: 'panes', title: 'Panes', description: 'Find, open, and close workspace panes.',
    bounds: { x: 16, y: 16, width: 350, height: 470 },
    create: (body, options) => createPaneSelector(body, { ...options, world, dispatch: act }) });
  for (const definition of definitions) world.register(definition);
  world.register({ id: 'activity', title: 'Activity', description: 'Errors reported by this workspace during this page session.',
    bounds: { x: 100, y: 100, width: 620, height: 360 },
    create(body) {
      body.classList.add('pane-content');
      const refresh = () => {
        body.replaceChildren();
        if (!activity.length) body.append(element('p', 'No errors reported in this page session.'));
        for (const entry of activity) {
          const row = element('article', undefined, 'workspace-record');
          row.append(element('time', new Date(entry.time).toLocaleTimeString()), element('p', entry.message));
          body.append(row);
        }
      };
      refresh();
      return { refresh, state: () => activity };
    } });
  for (const failure of world.loadFailures) report(new Error(`${failure.file}: ${failure.className}: ${failure.message}`));
  const sourceStore = new SourceStore({ runtime: world.runtime, packages: sources, report });
  const defaults = world.layout();
  for (const pane of defaults.panes) pane.visible = pane.id === 'panes' || definitions.some(definition => definition.id === pane.id && definition.open);
  const reset = () => {
    const dynamic = [...world.panes.values()].filter(pane => !defaults.panes.some(value => value.id === pane.id))
      .map(pane => ({ id: pane.id, ...pane.initialBounds, visible: pane.object.slots.visible, enlarged: false }));
    world.restore({ ...defaults, panes: [...defaults.panes, ...dynamic] });
    world.send('panes', 'focus');
  };
  let saved = null;
  try {
    const stored = storage?.getItem(storageKey);
    if (stored) {
      const layout = JSON.parse(stored);
      world.restore(layout);
      saved = layout;
      for (const pane of defaults.panes) {
        if (pane.visible && !layout.panes.some(entry => entry.id === pane.id)) world.send(pane.id, 'open');
      }
    }
    else reset();
  } catch (error) { report(error); reset(); }
  ready = true;
  world.panes.get('panes')?.view.refresh();
  on(paneButton, 'click', () => act({ op: 'open', id: 'panes' }));
  on(notice, 'click', () => act({ op: 'open', id: 'activity' }));
  on(resetButton, 'click', reset);
  on(window, 'pagehide', save);
  const resize = new ResizeObserver(() => { if (!disposed) world.fit(); });
  resize.observe(container);
  return {
    world, dispatch, report, sources: sourceStore,
    add(definition) {
      const pane = world.register(definition);
      pane.initialBounds = world.rectangle(pane);
      const entry = saved?.panes.find(item => item.id === pane.id);
      if (entry) {
        try { world.restore({ version: 1, panes: [entry] }); }
        catch (error) { report(error); }
      } else if (definition.open) world.send(pane.id, 'open');
      changed();
      return pane;
    },
    state: () => ({ ...world.dispatch({ op: 'state' }), activity: [...activity] }),
    dispose() {
      save();
      disposed = true;
      clearTimeout(saveTimer);
      resize.disconnect();
      events.abort();
      sourceStore.dispose();
      world.dispose();
      paneButton.remove(); resetButton.remove(); notice.remove();
    },
  };
}
