export function create(configuration, context) {
  let output;
  let reading = null;
  let refreshNumber = 0;
  const render = () => {
    if (!output) return;
    output.textContent = reading ? [reading.path,
      `Used bytes: ${reading.usedBytes}`, `Free bytes: ${reading.freeBytes}`,
      `Available bytes: ${reading.availableBytes}`, `Read at: ${reading.observedAt}`].join('\n') : 'Refresh to read disk usage.';
  };
  return {
    mount(root) {
      root.classList.add('pane-content');
      output = document.createElement('pre');
      output.setAttribute('aria-label', 'Disk usage');
      const refresh = document.createElement('button');
      refresh.textContent = 'Refresh';
      refresh.addEventListener('click', context.action('refresh'), { signal: context.signal });
      root.append(refresh, output);
      render();
    },
    async refresh() {
      const number = ++refreshNumber;
      const next = await context.send(context.binding('disk'), 'usage');
      if (number === refreshNumber) { reading = next; render(); context.changed(); }
      return next;
    },
    state() { return { reading }; },
    dispose() { output = null; },
  };
}
