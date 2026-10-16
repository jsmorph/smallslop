import { element } from './pane-view.js';

export function createPaneSelector(body, { world, on, dispatch }) {
  body.classList.add('pane-selector');
  const filter = element('input');
  filter.type = 'search';
  filter.placeholder = 'Find a pane';
  filter.setAttribute('aria-label', 'Find a pane');
  const list = element('div', undefined, 'pane-choices');
  body.append(filter, list);
  const entries = new Map();
  const add = pane => {
    const row = element('article', undefined, 'pane-choice');
    row.dataset.choice = pane.id;
    const heading = element('div', undefined, 'pane-choice-heading');
    const name = element('h3', pane.title);
    const open = element('button', 'Open');
    const close = element('button', 'Close');
    close.setAttribute('aria-label', `Close ${pane.title}`);
    on(open, 'click', () => dispatch({ op: 'open', id: pane.id }));
    on(close, 'click', () => dispatch({ op: 'close', id: pane.id }));
    heading.append(name, open, close);
    row.append(heading, element('p', [pane.association?.label, pane.description].filter(Boolean).join(' · ')));
    if (pane.association) row.style.borderLeft = `4px solid ${pane.association.color}`;
    list.append(row);
    entries.set(pane.id, { pane, row, open, close });
  };
  const refresh = () => {
    for (const [id, entry] of entries) if (!world.panes.has(id)) { entry.row.remove(); entries.delete(id); }
    for (const pane of world.panes.values()) if (!entries.has(pane.id)) add(pane);
    const query = filter.value.trim().toLowerCase();
    for (const { pane, row, open, close } of entries.values()) {
      row.hidden = !`${pane.title} ${pane.description} ${pane.association?.label ?? ''}`.toLowerCase().includes(query);
      const visible = pane.object.slots.visible;
      open.textContent = visible ? 'Show' : 'Open';
      open.setAttribute('aria-label', `${visible ? 'Show' : 'Open'} ${pane.title}`);
      close.hidden = !visible;
    }
  };
  on(filter, 'input', refresh);
  refresh();
  return { refresh, visibility(shown) { if (shown) refresh(); } };
}
