import { store, cloneStateValue } from "../../core/store.js";
import { history } from "../../core/history.js";
import { layerManager } from "../../layers/layerManager.js";
import { layerThumbnails } from "../../layers/thumbnails.js";
import { getBlendModes } from "../../layers/blendModes.js";
import { initTools } from "../../tools/index.js";

const BLEND_MODE_OPTIONS = getBlendModes();
const DROP_BEFORE_CLASS = "is-drop-before";
const DROP_AFTER_CLASS = "is-drop-after";
const DRAGGING_CLASS = "is-dragging";

export function renderLayersPanel() {
  return `
    <div class="layers-panel" data-layers-panel>
      <ul
        class="panel-list layers-panel__list"
        data-layer-list
        role="tree"
        aria-label="Layer stack"
        aria-multiselectable="true"
      ></ul>
      <div class="panel-actions layers-panel__actions">
        <button type="button" class="panel-cta" data-layer-add>Add Layer</button>
        <button type="button" class="panel-cta" data-layer-duplicate disabled>Duplicate</button>
        <button type="button" class="panel-cta" data-layer-delete disabled>Delete</button>
      </div>
    </div>
  `;
}

export function initLayersPanel(panelElement) {
  const root = panelElement?.querySelector("[data-layers-panel]");
  if (!root) {
    return;
  }

  const listElement = root.querySelector("[data-layer-list]");
  const addButton = root.querySelector("[data-layer-add]");
  const duplicateButton = root.querySelector("[data-layer-duplicate]");
  const deleteButton = root.querySelector("[data-layer-delete]");

  const toolsApi = initTools();
  const moveTool = typeof toolsApi.getTool === "function" ? toolsApi.getTool("move") : null;

  let dragState = null;

  const unsubscribe = store.subscribe(
    (state) => {
      updateLayerList(listElement, state);
      updateActionButtons({ addButton, duplicateButton, deleteButton }, state);
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

  listElement.addEventListener("click", (event) => {
    const toggleButton = event.target.closest("[data-layer-toggle]");
    if (toggleButton) {
      event.preventDefault();
      const item = toggleButton.closest("[data-layer-id]");
      if (!item) {
        return;
      }
      const layerId = item.dataset.layerId;
      handleToggleVisibility(layerId);
      return;
    }

    const lockButton = event.target.closest("[data-layer-lock]");
    if (lockButton) {
      event.preventDefault();
      const item = lockButton.closest("[data-layer-id]");
      if (!item) {
        return;
      }
      handleToggleLock(item.dataset.layerId);
      return;
    }

    const renameButton = event.target.closest("[data-layer-rename]");
    if (renameButton) {
      event.preventDefault();
      const item = renameButton.closest("[data-layer-id]");
      if (!item) {
        return;
      }
      promptRenameLayer(item.dataset.layerId);
      return;
    }

    const item = event.target.closest("[data-layer-id]");
    if (!item) {
      return;
    }

    handleLayerSelection(item.dataset.layerId, event, moveTool);
  });

  listElement.addEventListener("dblclick", (event) => {
    const nameElement = event.target.closest("[data-layer-name]");
    if (!nameElement) {
      return;
    }
    const item = nameElement.closest("[data-layer-id]");
    if (!item) {
      return;
    }
    promptRenameLayer(item.dataset.layerId);
  });

  listElement.addEventListener("change", (event) => {
    const select = event.target.closest("[data-layer-blend]");
    if (!select) {
      return;
    }
    const item = select.closest("[data-layer-id]");
    if (!item) {
      return;
    }
    const layerId = item.dataset.layerId;
    const blendMode = select.value;
    event.stopPropagation();
    handleBlendModeChange(layerId, blendMode);
  });

  listElement.addEventListener("keydown", (event) => {
    const item = event.target.closest("[data-layer-id]");
    if (!item) {
      return;
    }

    const layerId = item.dataset.layerId;

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      handleToggleVisibility(layerId);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      handleLayerSelection(layerId, event, moveTool);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      handleDeleteLayers();
    }
  });

  listElement.addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-layer-id]");
    if (!item) {
      return;
    }

    const layerId = item.dataset.layerId;
    const layer = layerManager.getLayer(layerId);
    if (!layer || layer.locked) {
      event.preventDefault();
      return;
    }

    const state = store.getState();
    const selection = Array.isArray(state.selection?.items) ? state.selection.items : [];
    const candidateIds = selection.includes(layerId) ? selection.slice() : [layerId];
    const draggableIds = candidateIds.filter((id) => {
      const target = layerManager.getLayer(id);
      return target && !target.locked;
    });

    if (!draggableIds.length) {
      event.preventDefault();
      return;
    }

    dragState = {
      ids: draggableIds,
      sourceId: layerId,
      overId: null,
      dropPosition: null,
    };

    item.classList.add(DRAGGING_CLASS);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("application/x-layer-ids", JSON.stringify(draggableIds));
      } catch (error) {
        // ignore unsupported data types
      }
    }
  });

  listElement.addEventListener("dragenter", (event) => {
    const item = event.target.closest("[data-layer-id]");
    if (!dragState || !item) {
      return;
    }

    const layerId = item.dataset.layerId;
    if (dragState.ids.includes(layerId)) {
      clearDropIndicator();
      dragState.overId = null;
      dragState.dropPosition = null;
      return;
    }

    event.preventDefault();
  });

  listElement.addEventListener("dragover", (event) => {
    if (!dragState) {
      return;
    }

    const item = event.target.closest("[data-layer-id]");

    if (!item) {
      event.preventDefault();
      clearDropIndicator();
      dragState.overId = null;
      dragState.dropPosition = "after";
      return;
    }

    const layerId = item.dataset.layerId;
    if (dragState.ids.includes(layerId)) {
      event.preventDefault();
      clearDropIndicator();
      dragState.overId = null;
      dragState.dropPosition = null;
      return;
    }

    event.preventDefault();

    const rect = item.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const position = offset < rect.height / 2 ? "before" : "after";

    applyDropIndicator(item, position);
    dragState.overId = layerId;
    dragState.dropPosition = position;

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  });

  listElement.addEventListener("dragleave", (event) => {
    if (!dragState) {
      return;
    }

    const item = event.target.closest("[data-layer-id]");
    if (!item) {
      return;
    }

    if (!item.contains(event.relatedTarget)) {
      clearDropIndicator();
    }
  });

  listElement.addEventListener("drop", (event) => {
    if (!dragState) {
      return;
    }

    event.preventDefault();

    const targetId = dragState.overId;
    const position = dragState.dropPosition || "after";
    performReorder(dragState.ids, targetId, position);
    clearDragState();
  });

  listElement.addEventListener("dragend", () => {
    clearDragState();
  });

  addButton?.addEventListener("click", () => {
    handleAddLayer();
  });

  duplicateButton?.addEventListener("click", () => {
    handleDuplicateLayer();
  });

  deleteButton?.addEventListener("click", () => {
    handleDeleteLayers();
  });

  root.addEventListener(
    "panel:dispose",
    () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
      clearDragState();
    },
    { once: true }
  );

  function clearDragState() {
    clearDropIndicator();
    listElement.querySelectorAll(`.${DRAGGING_CLASS}`).forEach((element) => {
      element.classList.remove(DRAGGING_CLASS);
    });
    dragState = null;
  }

  function clearDropIndicator() {
    listElement.querySelectorAll(`.${DROP_BEFORE_CLASS}, .${DROP_AFTER_CLASS}`).forEach((element) => {
      element.classList.remove(DROP_BEFORE_CLASS, DROP_AFTER_CLASS);
    });
  }

  function applyDropIndicator(item, position) {
    clearDropIndicator();
    if (position === "before") {
      item.classList.add(DROP_BEFORE_CLASS);
      item.classList.remove(DROP_AFTER_CLASS);
    } else {
      item.classList.add(DROP_AFTER_CLASS);
      item.classList.remove(DROP_BEFORE_CLASS);
    }
  }
}

function updateLayerList(listElement, state) {
  const layers = layerManager.listLayers({ state, bottomFirst: false });
  const selectionSet = new Set(state.selection?.items || []);
  const activeId = state.layers?.active || null;

  const activeElement = typeof document !== "undefined" ? document.activeElement : null;
  const focusedLayerId =
    activeElement && listElement.contains(activeElement)
      ? activeElement.closest?.("[data-layer-id]")?.dataset.layerId || null
      : null;

  if (!layers.length) {
    listElement.innerHTML = '<li class="panel-list__item is-empty">No layers available</li>';
    return;
  }

  const markup = layers.map((layer) => renderLayerListItem(layer, selectionSet, activeId)).join("");
  listElement.innerHTML = markup;

  layers.forEach((layer) => {
    const container = listElement.querySelector(`[data-layer-id="${escapeSelector(layer.id)}"] [data-layer-thumb]`);
    if (!container) {
      return;
    }
    const thumbnail = layerThumbnails.getThumbnail(layer.id, { width: 96, height: 64 });
    container.innerHTML = "";
    if (thumbnail) {
      thumbnail.classList.add("layer-item__thumbnail");
      container.appendChild(thumbnail);
    }
  });

  if (focusedLayerId) {
    const nextFocus = listElement.querySelector(`[data-layer-id="${escapeSelector(focusedLayerId)}"]`);
    if (nextFocus) {
      nextFocus.focus();
    }
  }
}

function renderLayerListItem(layer, selectionSet, activeId) {
  const classes = ["panel-list__item", "layer-item"];
  if (layer.id === activeId) {
    classes.push("is-active");
  }
  if (selectionSet.has(layer.id) && layer.id !== activeId) {
    classes.push("is-selected");
  }
  if (layer.visible === false) {
    classes.push("is-hidden");
  }
  if (layer.locked) {
    classes.push("is-locked");
  }

  const toggleLabel = layer.visible === false ? "Show layer" : "Hide layer";
  const lockLabel = layer.locked ? "Unlock layer" : "Lock layer";

  return `
    <li
      class="${classes.join(" ")}"
      data-layer-id="${layer.id}"
      role="treeitem"
      aria-selected="${selectionSet.has(layer.id)}"
      tabindex="0"
      draggable="${layer.locked ? "false" : "true"}"
    >
      <div class="layer-item__controls">
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
        <button
          type="button"
          class="layer-item__lock"
          data-layer-lock
          aria-pressed="${layer.locked}"
          title="${lockLabel}"
        >
          <span aria-hidden="true">${layer.locked ? "🔒" : "🔓"}</span>
          <span class="sr-only">${lockLabel}</span>
        </button>
      </div>
      <div class="layer-item__preview" data-layer-thumb></div>
      <div class="layer-item__summary">
        <div class="layer-item__header">
          <span class="layer-item__name" data-layer-name>${escapeHtml(layer.name || "Layer")}</span>
          <button type="button" class="layer-item__rename" data-layer-rename title="Rename layer">✎</button>
        </div>
        <div class="layer-item__meta-row">
          <span class="layer-item__meta">${escapeHtml(formatLayerMeta(layer))}</span>
          <label class="layer-item__blend-label">
            <span class="sr-only">Blend mode</span>
            <select class="layer-item__blend" data-layer-blend>
              ${renderBlendOptions(layer.blendingMode)}
            </select>
          </label>
        </div>
      </div>
    </li>
  `;
}

function renderBlendOptions(activeMode) {
  const options = BLEND_MODE_OPTIONS.map((mode) => {
    const selected = mode.id === normaliseBlendModeId(activeMode) ? "selected" : "";
    return `<option value="${mode.id}" ${selected}>${escapeHtml(mode.label)}</option>`;
  });
  return options.join("");
}

function normaliseBlendModeId(value) {
  if (typeof value !== "string") {
    return "normal";
  }
  return value.trim().toLowerCase();
}

function updateActionButtons(buttons, state) {
  const targetIds = getTargetLayerIds(state);
  const removableIds = targetIds.filter((id) => {
    const layer = layerManager.getLayer(id);
    return layer && !layer.locked;
  });

  if (buttons.addButton) {
    buttons.addButton.disabled = false;
  }

  if (buttons.duplicateButton) {
    buttons.duplicateButton.disabled = targetIds.length === 0;
  }

  if (buttons.deleteButton) {
    buttons.deleteButton.disabled = removableIds.length === 0;
  }
}

function handleLayerSelection(layerId, event, moveTool) {
  if (!layerId) {
    return;
  }

  const selectionMode = event.shiftKey ? "add" : event.metaKey || event.ctrlKey ? "subtract" : "replace";
  let moveToolRef = moveTool;

  if (!moveToolRef) {
    const toolsApi = initTools();
    moveToolRef = typeof toolsApi.getTool === "function" ? toolsApi.getTool("move") : null;
  }

  if (moveToolRef && typeof moveToolRef.selectLayers === "function") {
    moveToolRef.selectLayers([layerId], { mode: selectionMode });
    return;
  }

  const state = store.getState();
  const existingSelection = Array.isArray(state.selection?.items) ? state.selection.items : [];
  let nextSelection;

  if (selectionMode === "add") {
    nextSelection = Array.from(new Set([...existingSelection, layerId]));
  } else if (selectionMode === "subtract") {
    nextSelection = existingSelection.filter((id) => id !== layerId);
  } else {
    nextSelection = [layerId];
  }

  store.updateSlice(
    "selection",
    (selection) => ({
      ...selection,
      items: nextSelection,
      bounds: null,
      mode: selectionMode,
    }),
    { reason: "layers:manual-selection", source: "layers-panel" }
  );

  layerManager.setActiveLayer(layerId, { source: "layers-panel", updateSelection: true });
}

function handleAddLayer() {
  const state = store.getState();
  const activeId = state.layers?.active || null;

  executeLayerCommand("Add Layer", () => {
    layerManager.createLayer(
      {},
      {
        source: "layers-panel",
        before: activeId || undefined,
        setActive: true,
        updateSelection: true,
      }
    );
  });
}

function handleDuplicateLayer() {
  const state = store.getState();
  const primary = getPrimaryTargetId(state);
  if (!primary) {
    return;
  }

  executeLayerCommand("Duplicate Layer", () => {
    layerManager.duplicateLayer(primary, {
      source: "layers-panel",
      setActive: true,
      updateSelection: true,
      offset: { x: 16, y: 16 },
    });
  });
}

function handleDeleteLayers() {
  const state = store.getState();
  const removableIds = getRemovableLayerIds(state);
  if (!removableIds.length) {
    return;
  }

  const label = removableIds.length > 1 ? "Delete Layers" : "Delete Layer";

  executeLayerCommand(label, () => {
    layerManager.removeLayers(removableIds, {
      source: "layers-panel",
      updateSelection: true,
    });
  });
}

function handleToggleVisibility(layerId) {
  const layer = layerManager.getLayer(layerId);
  if (!layer) {
    return;
  }

  const label = layer.visible === false ? "Show Layer" : "Hide Layer";

  executeLayerCommand(label, () => {
    layerManager.toggleVisibility(layerId, !layer.visible, { source: "layers-panel" });
  });
}

function handleToggleLock(layerId) {
  const layer = layerManager.getLayer(layerId);
  if (!layer) {
    return;
  }

  const label = layer.locked ? "Unlock Layer" : "Lock Layer";

  executeLayerCommand(label, () => {
    layerManager.toggleLock(layerId, !layer.locked, { source: "layers-panel" });
  });
}

function handleBlendModeChange(layerId, blendMode) {
  const layer = layerManager.getLayer(layerId);
  if (!layer) {
    return;
  }

  const normalised = normaliseBlendModeId(blendMode);
  if (normalised === normaliseBlendModeId(layer.blendingMode)) {
    return;
  }

  executeLayerCommand("Change Blend Mode", () => {
    layerManager.updateLayer(layerId, { blendingMode: normalised }, { source: "layers-panel" });
  });
}

function promptRenameLayer(layerId) {
  const layer = layerManager.getLayer(layerId);
  if (!layer) {
    return;
  }

  const nextName = typeof window !== "undefined" ? window.prompt("Rename layer", layer.name || "Layer") : null;
  if (nextName === null) {
    return;
  }

  const trimmed = nextName.trim();
  if (!trimmed || trimmed === layer.name) {
    return;
  }

  executeLayerCommand("Rename Layer", () => {
    layerManager.renameLayer(layerId, trimmed, { source: "layers-panel" });
  });
}

function performReorder(layerIds, targetId, position) {
  const state = store.getState();
  const currentOrder = Array.isArray(state.layers?.order) ? state.layers.order : [];
  const movedIds = layerIds.filter((id) => id && currentOrder.includes(id));

  if (!movedIds.length) {
    return;
  }

  if (targetId && movedIds.includes(targetId)) {
    return;
  }

  const nextOrder = previewReorder(currentOrder, movedIds, targetId, position);
  if (!nextOrder || arraysEqual(nextOrder, currentOrder)) {
    return;
  }

  const label = movedIds.length > 1 ? "Reorder Layers" : "Reorder Layer";

  executeLayerCommand(label, () => {
    if (!targetId) {
      layerManager.reorderLayers(
        movedIds,
        { position: position === "before" ? "top" : "bottom" },
        { source: "layers-panel" }
      );
      return;
    }
    layerManager.reorderLayers(
      movedIds,
      {
        [position === "after" ? "after" : "before"]: targetId,
      },
      { source: "layers-panel" }
    );
  });
}

function previewReorder(order, movedIds, targetId, position) {
  const remaining = order.filter((id) => !movedIds.includes(id));
  let insertIndex;

  if (!targetId) {
    insertIndex = position === "before" ? 0 : remaining.length;
  } else {
    const targetIndex = remaining.indexOf(targetId);
    if (targetIndex === -1) {
      insertIndex = remaining.length;
    } else {
      insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    }
  }

  const nextOrder = remaining.slice();
  nextOrder.splice(insertIndex, 0, ...movedIds);
  return nextOrder;
}

function getPrimaryTargetId(state) {
  const selection = Array.isArray(state.selection?.items) ? state.selection.items : [];
  if (selection.length) {
    return selection[selection.length - 1];
  }
  return state.layers?.active || null;
}

function getTargetLayerIds(state) {
  const selection = Array.isArray(state.selection?.items) ? state.selection.items : [];
  if (selection.length) {
    return selection;
  }
  const active = state.layers?.active;
  return active ? [active] : [];
}

function getRemovableLayerIds(state) {
  return getTargetLayerIds(state).filter((id) => {
    const layer = layerManager.getLayer(id);
    return layer && !layer.locked;
  });
}

function executeLayerCommand(label, perform) {
  let previousSnapshot = null;
  let nextSnapshot = null;
  let diff = { added: [], removed: [], changed: [] };

  const command = {
    label,
    execute() {
      previousSnapshot = captureSnapshot();
      perform();
      nextSnapshot = captureSnapshot();
      diff = diffLayerSnapshots(previousSnapshot.layers, nextSnapshot.layers);
      if (diff.added.length || diff.changed.length) {
        layerThumbnails.invalidateMany([...diff.added, ...diff.changed]);
      }
      if (diff.removed.length) {
        layerThumbnails.removeMany(diff.removed);
      }
    },
    undo() {
      if (!previousSnapshot) {
        return;
      }
      applySnapshot(previousSnapshot, { reason: "layers:undo", source: "layers-panel" });
      if (diff.removed.length || diff.changed.length) {
        layerThumbnails.invalidateMany([...diff.removed, ...diff.changed]);
      }
      if (diff.added.length) {
        layerThumbnails.removeMany(diff.added);
      }
    },
    redo() {
      if (!nextSnapshot) {
        return;
      }
      applySnapshot(nextSnapshot, { reason: "layers:redo", source: "layers-panel" });
      if (diff.added.length || diff.changed.length) {
        layerThumbnails.invalidateMany([...diff.added, ...diff.changed]);
      }
      if (diff.removed.length) {
        layerThumbnails.removeMany(diff.removed);
      }
    },
  };

  history.execute(command, null, {
    label,
    meta: { source: "layers-panel" },
  });
}

function captureSnapshot() {
  const state = store.getState();
  return {
    layers: cloneStateValue(state.layers),
    selection: cloneStateValue(state.selection),
  };
}

function applySnapshot(snapshot, meta = {}) {
  if (!snapshot) {
    return;
  }

  store.updateSlice(
    "layers",
    () => cloneStateValue(snapshot.layers),
    { reason: meta.reason || "layers:snapshot", source: meta.source || "layers-panel" }
  );

  store.updateSlice(
    "selection",
    () => cloneStateValue(snapshot.selection),
    { reason: meta.reason || "layers:snapshot", source: meta.source || "layers-panel" }
  );
}

function diffLayerSnapshots(previousLayers, nextLayers) {
  const prevOrder = Array.isArray(previousLayers?.order) ? previousLayers.order : [];
  const nextOrder = Array.isArray(nextLayers?.order) ? nextLayers.order : [];
  const prevEntities = previousLayers?.entities || {};
  const nextEntities = nextLayers?.entities || {};

  const added = [];
  const removed = [];
  const changed = [];

  const prevSet = new Set(prevOrder);
  const nextSet = new Set(nextOrder);

  prevSet.forEach((id) => {
    if (!nextSet.has(id)) {
      removed.push(id);
      return;
    }

    const previous = prevEntities[id];
    const next = nextEntities[id];

    const prevUpdated = previous?.updatedAt ?? 0;
    const nextUpdated = next?.updatedAt ?? 0;
    const prevVisible = previous?.visible === false ? false : true;
    const nextVisible = next?.visible === false ? false : true;
    const prevLocked = Boolean(previous?.locked);
    const nextLocked = Boolean(next?.locked);

    if (prevUpdated !== nextUpdated || prevVisible !== nextVisible || prevLocked !== nextLocked) {
      changed.push(id);
    }
  });

  nextSet.forEach((id) => {
    if (!prevSet.has(id)) {
      added.push(id);
    }
  });

  return { added, removed, changed };
}

function arraysEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function formatLayerMeta(layer) {
  const parts = [];
  if (layer.type) {
    parts.push(layer.type);
  }
  const width = layer.dimensions?.width;
  const height = layer.dimensions?.height;
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    parts.push(`${Math.round(width)}×${Math.round(height)}`);
  }
  if (typeof layer.opacity === "number" && layer.opacity < 1) {
    parts.push(`${Math.round(layer.opacity * 100)}%`);
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

function escapeSelector(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}
