import { renderPropertiesPanel, initPropertiesPanel } from "../modules/ui/panels/propertiesPanel.js";
import { renderLayersPanel, initLayersPanel } from "../modules/ui/panels/layersPanel.js";
import { renderColorPanel, initColorPanel } from "../modules/ui/panels/colorPanel.js";
import { store } from "../modules/core/store.js";

const STORAGE_TAB_KEY = "m8photo.sidebar.tab";

const TABS = [
  { id: "layers", title: "Layers", body: renderLayersPanel, onInit: initLayersPanel },
  { id: "properties", title: "Properties", body: renderPropertiesPanel, onInit: initPropertiesPanel },
  { id: "color", title: "Color", body: renderColorPanel, onInit: initColorPanel },
];

const EXTRA_PANELS = [
  { id: "adjustments", title: "Adjustments", collapsed: true, body: renderAdjustmentsPanel },
  { id: "activity", title: "Activity", collapsed: true, body: renderActivityPanel },
];

export function initPanels(scope = document) {
  const panelsEl = scope.querySelector("[data-panels]");
  if (!panelsEl) return;

  const selectedId = getInitialSelectedTab();

  panelsEl.innerHTML = `
    <div class="panels__tabs" role="tablist" aria-label="Sidebar tabs">
      ${TABS.map((t) => renderTabButton(t, selectedId)).join("")}
    </div>
    <div class="panels__scroll" data-panels-scroll>
      ${TABS.map((t) => renderTabPanel(t, selectedId)).join("")}
      ${EXTRA_PANELS.map((p, i) => renderPanel(p, i)).join("")}
    </div>
  `;

  // Initialise tab panel modules
  TABS.forEach((tab) => {
    const panelEl = panelsEl.querySelector(`[data-tab-panel="${tab.id}"]`);
    if (panelEl && typeof tab.onInit === "function") {
      tab.onInit(panelEl);
    }
  });

  // Tab interactions (click and keyboard)
  const tablist = panelsEl.querySelector(".panels__tabs");
  bindTabs(tablist, panelsEl);
}

function getInitialSelectedTab() {
  try {
    const key = localStorage.getItem(STORAGE_TAB_KEY);
    if (key && TABS.some((t) => t.id === key)) {
      return key;
    }
  } catch (_) {}
  return TABS[0].id;
}

function renderTabButton(tab, selectedId) {
  const selected = tab.id === selectedId;
  return `
    <button
      type="button"
      class="panels__tab"
      id="tab-${tab.id}"
      role="tab"
      aria-controls="panel-${tab.id}"
      aria-selected="${selected ? "true" : "false"}"
      tabindex="${selected ? "0" : "-1"}"
      data-tab="${tab.id}"
    >${tab.title}</button>
  `;
}

function renderTabPanel(tab, selectedId) {
  const selected = tab.id === selectedId;
  const content = typeof tab.body === "function" ? tab.body(tab) : tab.body || "";
  return `
    <section
      class="sidebar-panel"
      role="tabpanel"
      id="panel-${tab.id}"
      aria-labelledby="tab-${tab.id}"
      data-tab-panel="${tab.id}"
      ${selected ? "" : "hidden"}
    >
      ${content}
    </section>
  `;
}

function bindTabs(tablist, root) {
  if (!tablist || !root) return;

  const tabs = Array.from(tablist.querySelectorAll("[role=tab]"));
  const panels = Array.from(root.querySelectorAll("[role=tabpanel]"));

  function setActive(id, { focus = true } = {}) {
    tabs.forEach((tab) => {
      const isActive = tab.getAttribute("data-tab") === id;
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
      if (isActive && focus) tab.focus();
    });

    panels.forEach((panel) => {
      const match = panel.getAttribute("data-tab-panel") === id;
      panel.hidden = !match;
    });

    try {
      localStorage.setItem(STORAGE_TAB_KEY, id);
    } catch (_) {}
  }

  tablist.addEventListener("click", (e) => {
    const btn = e.target.closest("[role=tab][data-tab]");
    if (!btn) return;
    setActive(btn.getAttribute("data-tab"), { focus: false });
  });

  tablist.addEventListener("keydown", (e) => {
    const current = document.activeElement && document.activeElement.closest("[role=tab]");
    if (!current) return;
    const index = tabs.indexOf(current);
    if (index < 0) return;

    if (e.key === "ArrowRight" || e.key === "Right") {
      e.preventDefault();
      const next = tabs[(index + 1) % tabs.length];
      next.focus();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "Left") {
      e.preventDefault();
      const prev = tabs[(index - 1 + tabs.length) % tabs.length];
      prev.focus();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      tabs[0].focus();
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      tabs[tabs.length - 1].focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const id = current.getAttribute("data-tab");
      setActive(id, { focus: false });
    }
  });
}

function getCollapsedState(panelId, fallback = false) {
  try {
    const collapsed = store.getState()?.ui?.panels?.collapsed;
    if (collapsed && Object.prototype.hasOwnProperty.call(collapsed, panelId)) {
      return Boolean(collapsed[panelId]);
    }
  } catch (_) {}
  return Boolean(fallback);
}

function renderPanel(panel, index) {
  const content = typeof panel.body === "function" ? panel.body(panel, index) : panel.body || "";
  const panelId = panel.id || `panel-${index}`;
  const isCollapsed = getCollapsedState(panelId, panel.collapsed);
  const collapsedClass = isCollapsed ? " is-collapsed" : "";

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
