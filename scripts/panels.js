import { renderPropertiesPanel, initPropertiesPanel } from "../modules/ui/panels/propertiesPanel.js";

const PANELS = [
  {
    id: "properties",
    title: "Properties",
    collapsed: false,
    body: renderPropertiesPanel,
    onInit: initPropertiesPanel,
  },
  {
    id: "layers",
    title: "Layers",
    collapsed: false,
    body: renderLayersPanel,
  },
  {
    id: "adjustments",
    title: "Adjustments",
    collapsed: true,
    body: renderAdjustmentsPanel,
  },
  {
    id: "activity",
    title: "Activity",
    collapsed: true,
    body: renderActivityPanel,
  },
];

export function initPanels(scope = document) {
  const panelsEl = scope.querySelector("[data-panels]");

  if (!panelsEl) {
    return;
  }

  panelsEl.innerHTML = PANELS.map(renderPanel).join("");

  PANELS.forEach((panel) => {
    if (typeof panel.onInit === "function") {
      const section = panelsEl.querySelector(`[data-panel-id="${panel.id}"]`);
      if (section) {
        panel.onInit(section);
      }
    }
  });
}

function renderPanel(panel, index) {
  const content = typeof panel.body === "function" ? panel.body(panel, index) : panel.body || "";
  const collapsedClass = panel.collapsed ? " is-collapsed" : "";
  const panelId = panel.id || `panel-${index}`;

  return `
    <section class="panel${collapsedClass}" data-collapsible data-panel-id="${panelId}">
      <header class="panel__header">
        <h2 class="panel__title" id="${panelId}-title">${panel.title}</h2>
        <button
          class="panel__toggle"
          type="button"
          aria-controls="${panelId}-content"
          aria-labelledby="${panelId}-title"
          data-collapsible-toggle
        >
          <span class="sr-only">Toggle ${panel.title}</span>
          <span aria-hidden="true">▾</span>
        </button>
      </header>
      <div class="panel__content" id="${panelId}-content" data-collapsible-content>
        ${content}
      </div>
    </section>
  `;
}

function renderLayersPanel() {
  return `
    <ul class="panel-list">
      <li class="panel-list__item is-active">Hero Retouch</li>
      <li class="panel-list__item">Gradient Overlay</li>
      <li class="panel-list__item">Backdrop Blur</li>
    </ul>
    <button type="button" class="panel-cta">Add Layer</button>
  `;
}

function renderAdjustmentsPanel() {
  return `
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
  `;
}

function renderActivityPanel() {
  return `
    <ol class="panel-timeline">
      <li>Imported RAW asset</li>
      <li>Applied lens correction</li>
      <li>Fine-tuned luminance mask</li>
    </ol>
  `;
}
