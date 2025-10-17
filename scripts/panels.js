const PANELS = [
  {
    title: "Layers",
    collapsed: false,
    body: () => `
      <ul class="panel-list">
        <li class="panel-list__item is-active">Hero Retouch</li>
        <li class="panel-list__item">Gradient Overlay</li>
        <li class="panel-list__item">Backdrop Blur</li>
      </ul>
      <button type="button" class="panel-cta">Add Layer</button>
    `,
  },
  {
    title: "Adjustments",
    collapsed: true,
    body: () => `
      <div class="panel-control">
        <span class="panel-control__label">Exposure</span>
        <div class="slider-track" role="presentation">
          <div class="slider-thumb" style="--value: 62%"></div>
        </div>
      </div>
      <div class="panel-control">
        <span class="panel-control__label">Contrast</span>
        <div class="slider-track" role="presentation">
          <div class="slider-thumb" style="--value: 38%"></div>
        </div>
      </div>
      <button type="button" class="panel-cta">Reset Adjustments</button>
    `,
  },
  {
    title: "Activity",
    collapsed: true,
    body: () => `
      <ol class="panel-timeline">
        <li>Imported RAW asset</li>
        <li>Applied lens correction</li>
        <li>Fine-tuned luminance mask</li>
      </ol>
    `,
  },
];

export function initPanels(scope = document) {
  const panelsEl = scope.querySelector("[data-panels]");

  if (!panelsEl) {
    return;
  }

  panelsEl.innerHTML = `
    ${PANELS.map(renderPanel).join("")}
  `;
}

function renderPanel(panel, index) {
  const id = `panel-${index}`;
  const collapsedClass = panel.collapsed ? " is-collapsed" : "";
  return `
    <section class="panel${collapsedClass}" data-collapsible>
      <header class="panel__header">
        <h2 class="panel__title" id="${id}-title">${panel.title}</h2>
        <button
          class="panel__toggle"
          type="button"
          aria-controls="${id}-content"
          aria-labelledby="${id}-title"
          data-collapsible-toggle
        >
          <span class="sr-only">Toggle ${panel.title}</span>
          <span aria-hidden="true">▾</span>
        </button>
      </header>
      <div class="panel__content" id="${id}-content" data-collapsible-content>
        ${panel.body()}
      </div>
    </section>
  `;
}
