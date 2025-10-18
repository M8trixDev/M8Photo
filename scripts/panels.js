import { renderPropertiesPanel, initPropertiesPanel } from "../modules/ui/panels/propertiesPanel.js";

import { store } from "../modules/core/store.js";
import { createLayerManager } from "../modules/layers/layerManager.js";
import { initTools } from "../modules/tools/index.js";

const layerManager = createLayerManager();

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
    onInit: initLayersPanel,
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
    <div class="layers-panel" data-layers-panel>
      <ul class="panel-list" data-layer-list role="tree" aria-label="Layer stack" aria-multiselectable="true"></ul>
      <div class="panel-actions">
        <button type="button" class="panel-cta" data-layer-add disabled title="Layer creation coming soon">Add Layer</button>
      </div>
    </div>
  `;
}

function initLayersPanel(panelElement) {
  const list = panelElement?.querySelector("[data-layer-list]");
  if (!list) {
    return;
  }

  const toolsApi = initTools();
  const moveTool = typeof toolsApi.getTool === "function" ? toolsApi.getTool("move") : null;

  const unsubscribe = store.subscribe(
    () => {
      updateLayerList(list);
    },
    {
      selector: (state) => ({ layers: state.layers, selection: state.selection }),
      equality: (next, previous) =>
        next &&
        previous &&
        next.layers === previous.layers &&
        next.selection === previous.selection,
      fireImmediately: true,
    }
  );

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(
      "beforeunload",
      () => {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      },
      { once: true }
    );
  }

  list.addEventListener("click", (event) => {
    const visibilityToggle = event.target.closest("[data-layer-toggle]");
    if (visibilityToggle) {
      event.preventDefault();
      const item = visibilityToggle.closest("[data-layer-id]");
      const layerId = item?.dataset.layerId;
      if (!layerId || item?.classList.contains("is-locked")) {
        return;
      }
      layerManager.toggleVisibility(layerId, undefined, { source: "layers-panel" });
      return;
    }

    const item = event.target.closest("[data-layer-id]");
    if (!item) {
      return;
    }

    const layerId = item.dataset.layerId;
    if (!layerId) {
      return;
    }

    handleLayerSelection(layerId, moveTool, event);
  });

  list.addEventListener("keydown", (event) => {
    const item = event.target.closest("[data-layer-id]");
    if (!item) {
      return;
    }

    const layerId = item.dataset.layerId;
    if (!layerId) {
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      const toggle = item.querySelector("[data-layer-toggle]");
      if (toggle) {
        toggle.click();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      handleLayerSelection(layerId, moveTool, event);
    }
  });

  updateLayerList(list);
}

function updateLayerList(listElement) {
  const state = store.getState();
  const layers = layerManager.listLayers({ state, bottomFirst: false });
  const selectionSet = new Set(state.selection?.items || []);
  const activeLayerId = state.layers?.active || null;

  const activeElement = typeof document !== "undefined" ? document.activeElement : null;
  const focusedLayerId =
    activeElement && listElement.contains(activeElement)
      ? activeElement.closest?.("[data-layer-id]")?.dataset.layerId || null
      : null;

  if (!layers.length) {
    listElement.innerHTML = '<li class="panel-list__item is-empty">No layers available</li>';
    return;
  }

  const markup = layers
    .map((layer) => renderLayerListItem(layer, selectionSet, activeLayerId))
    .join("");
  listElement.innerHTML = markup;

  if (focusedLayerId) {
    const nextFocus = listElement.querySelector(`[data-layer-id="${focusedLayerId}"]`);
    if (nextFocus) {
      nextFocus.focus();
    }
  }
}

function handleLayerSelection(layerId, moveTool, event) {
  const mode = event.shiftKey ? "add" : event.metaKey || event.ctrlKey ? "subtract" : "replace";

  if (moveTool && typeof moveTool.selectLayers === "function") {
    moveTool.selectLayers([layerId], { mode });
    return;
  }

  layerManager.setActiveLayer(layerId, { source: "layers-panel", updateSelection: true });
}

function renderLayerListItem(layer, selectionSet, activeLayerId) {
  const classes = ["panel-list__item", "layer-item"];
  if (layer.id === activeLayerId) {
    classes.push("is-active");
  }
  if (selectionSet.has(layer.id) && layer.id !== activeLayerId) {
    classes.push("is-selected");
  }
  if (layer.visible === false) {
    classes.push("is-hidden");
  }
  if (layer.locked) {
    classes.push("is-locked");
  }

  const meta = formatLayerMeta(layer);
  const toggleLabel = layer.visible === false ? "Show layer" : "Hide layer";

  return `
    <li
      class="${classes.join(" ")}"
      data-layer-id="${layer.id}"
      role="treeitem"
      aria-selected="${selectionSet.has(layer.id)}"
      tabindex="0"
    >
      <button
        type="button"
        class="layer-item__visibility"
        data-layer-toggle
        aria-pressed="${layer.visible !== false}"
        title="${toggleLabel}"
      >
        <span aria-hidden="true">${layer.visible !== false ? "▣" : "▢"}</span>
        <span class="sr-only">${toggleLabel}</span>
      </button>
      <div class="layer-item__summary">
        <span class="layer-item__name">${escapeHtml(layer.name || `Layer ${layer.orderIndex + 1}`)}</span>
        ${meta ? `<span class="layer-item__meta">${escapeHtml(meta)}</span>` : ""}
      </div>
    </li>
  `;
}

function formatLayerMeta(layer) {
  const parts = [];
  if (layer.type) {
    parts.push(layer.type);
  }
  if (typeof layer.opacity === "number" && layer.opacity < 1) {
    parts.push(`${Math.round(layer.opacity * 100)}%`);
  }
  if (layer.blendingMode && layer.blendingMode !== "normal") {
    parts.push(layer.blendingMode);
  }
  return parts.join(" • ");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
