import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { layerManager } from "../layers/layerManager.js";
import { clampZoom } from "../view/viewport.js";

const TEXT_CREATE_COMMAND = "tool:text:create";
const TEXT_UPDATE_COMMAND = "tool:text:update";

const DEFAULT_TEXT_OPTIONS = Object.freeze({
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  fontSize: 48,
  fontWeight: 400,
  align: "left",
  color: "#ffffff",
});

function normaliseTextOptions(options = {}) {
  const next = { ...DEFAULT_TEXT_OPTIONS, ...(options || {}) };
  const size = Number(next.fontSize);
  next.fontSize = Number.isFinite(size) ? Math.min(Math.max(size, 6), 512) : 48;
  const weight = Number(next.fontWeight);
  next.fontWeight = Number.isFinite(weight) ? Math.min(Math.max(Math.round(weight), 100), 900) : 400;
  const align = String(next.align || "left").toLowerCase();
  next.align = ["left", "center", "right"].includes(align) ? align : "left";
  const color = typeof next.color === "string" && next.color.trim() !== "" ? next.color.trim() : "#ffffff";
  next.color = color;
  const family = typeof next.fontFamily === "string" && next.fontFamily.trim() !== "" ? next.fontFamily.trim() : DEFAULT_TEXT_OPTIONS.fontFamily;
  next.fontFamily = family;
  return next;
}

function computeWorkspacePointFromEvent(event) {
  const canvas = document.getElementById("workspace-canvas");
  const stage = canvas?.closest("[data-viewport-stage]") || canvas?.parentElement;
  if (!canvas || !stage) {
    return { x: 0, y: 0 };
  }
  const viewport = store.getState().viewport || {};
  const zoom = clampZoom(viewport.zoom ?? 1, viewport.minZoom, viewport.maxZoom);
  const workspaceWidth = viewport.size?.width || canvas.clientWidth || 1;
  const workspaceHeight = viewport.size?.height || canvas.clientHeight || 1;
  const pan = viewport.pan || { x: 0, y: 0 };
  const baseX = (canvas.clientWidth - workspaceWidth * zoom) / 2;
  const baseY = (canvas.clientHeight - workspaceHeight * zoom) / 2;
  const translateX = baseX + pan.x;
  const translateY = baseY + pan.y;
  const offsetX = typeof event.offsetX === "number" ? event.offsetX : (event.clientX - canvas.getBoundingClientRect().left);
  const offsetY = typeof event.offsetY === "number" ? event.offsetY : (event.clientY - canvas.getBoundingClientRect().top);
  const worldX = (offsetX - translateX) / zoom;
  const worldY = (offsetY - translateY) / zoom;
  return { x: worldX, y: worldY };
}

function computeScreenPointFromWorld(x, y) {
  const canvas = document.getElementById("workspace-canvas");
  if (!canvas) return { x: 0, y: 0, zoom: 1 };
  const viewport = store.getState().viewport || {};
  const zoom = clampZoom(viewport.zoom ?? 1, viewport.minZoom, viewport.maxZoom);
  const workspaceWidth = viewport.size?.width || canvas.clientWidth || 1;
  const workspaceHeight = viewport.size?.height || canvas.clientHeight || 1;
  const pan = viewport.pan || { x: 0, y: 0 };
  const baseX = (canvas.clientWidth - workspaceWidth * zoom) / 2;
  const baseY = (canvas.clientHeight - workspaceHeight * zoom) / 2;
  const translateX = baseX + pan.x;
  const translateY = baseY + pan.y;
  return { x: x * zoom + translateX, y: y * zoom + translateY, zoom };
}

function ensureEditorContainer() {
  const stage = document.querySelector("[data-viewport-stage]");
  if (!stage) return null;
  let el = stage.querySelector("[data-text-editor]");
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("data-text-editor", "");
    el.contentEditable = "true";
    el.className = "text-editor-overlay";
    el.style.position = "absolute";
    el.style.outline = "none";
    el.style.whiteSpace = "pre-wrap";
    el.style.wordBreak = "break-word";
    el.style.transformOrigin = "top left";
    el.style.minWidth = "2px";
    el.style.minHeight = "1em";
    el.style.pointerEvents = "auto";
    el.hidden = true;
    stage.appendChild(el);
  }
  return el;
}

function measureEditor(el, zoom) {
  if (!el || !el.getBoundingClientRect) return { width: 0, height: 0 };
  const rect = el.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width / (zoom || 1)));
  const height = Math.max(1, Math.round(rect.height / (zoom || 1)));
  return { width, height };
}

function buildFontCss(options) {
  const opt = normaliseTextOptions(options);
  const weight = opt.fontWeight || 400;
  return `${weight} ${opt.fontSize}px ${opt.fontFamily}`;
}

function registerTextCommands() {
  if (!history.hasCommand(TEXT_CREATE_COMMAND)) {
    history.registerCommand(TEXT_CREATE_COMMAND, ({ payload }) => {
      const definition = payload?.definition || {};
      const meta = payload?.meta || {};
      let createdLayerId = null;
      return {
        type: TEXT_CREATE_COMMAND,
        label: "Create Text",
        meta: { tool: "text" },
        execute() {
          const created = layerManager.createLayer(
            { ...definition, type: "text" },
            { ...meta, source: meta.source || "text-tool", setActive: true, updateSelection: true }
          );
          createdLayerId = created?.id || created?.layerId || created?.renderLayer?.id || created?.id;
          return createdLayerId;
        },
        undo() {
          if (!createdLayerId) return null;
          layerManager.removeLayer(createdLayerId, { source: meta.source || "text-tool", updateSelection: true });
          return createdLayerId;
        },
        redo() {
          const created = layerManager.createLayer(
            { ...definition, id: definition.id || createdLayerId, type: "text" },
            { ...meta, source: meta.source || "text-tool", setActive: true, updateSelection: true, uniqueName: false }
          );
          createdLayerId = created?.id || createdLayerId;
          return createdLayerId;
        },
      };
    });
  }

  if (!history.hasCommand(TEXT_UPDATE_COMMAND)) {
    history.registerCommand(TEXT_UPDATE_COMMAND, ({ payload }) => {
      const layerId = payload?.layerId;
      const changes = payload?.changes || {};
      const options = payload?.options || {};
      const coalesceKey = `text:update:${layerId}`;
      let before = null;
      return {
        type: TEXT_UPDATE_COMMAND,
        label: "Edit Text",
        meta: { tool: "text", layerId },
        options: { coalesce: true, coalesceKey, coalesceWindow: Math.max(200, Number(options.coalesceWindow) || 800) },
        changes,
        execute() {
          const state = store.getState();
          const layer = state.layers?.entities?.[layerId];
          if (!layer) return null;
          before = { ...layer, metadata: { ...(layer.metadata || {}) }, dimensions: { ...(layer.dimensions || {}) } };
          const nextChanges = this.changes || changes;
          layerManager.updateLayer(layerId, nextChanges, { source: options.source || "text-tool" });
          return layerId;
        },
        undo() {
          if (!before) return null;
          // Restore previous snapshot
          const snapshot = { ...before };
          layerManager.updateLayer(layerId, { ...snapshot }, { source: options.source || "text-tool" });
          return layerId;
        },
        redo() {
          const nextChanges = this.changes || changes;
          layerManager.updateLayer(layerId, nextChanges, { source: options.source || "text-tool" });
          return layerId;
        },
        coalesceWith(other) {
          if (!other || other.type !== TEXT_UPDATE_COMMAND || other.meta?.layerId !== layerId) return false;
          // Merge changes; retain earliest before snapshot
          this.changes = { ...(this.changes || changes), ...(other.changes || other.payload?.changes || {}) };
          return true;
        },
      };
    });
  }
}

export function createTextTool(context = {}) {
  registerTextCommands();

  const api = {
    id: "text",
    label: "Text",
    cursor: "text",
    getDefaultOptions() {
      return { ...DEFAULT_TEXT_OPTIONS };
    },
    normalizeOptions(nextOptions = {}) {
      return normaliseTextOptions(nextOptions);
    },
    onActivate(meta) {
      attachPointerHandlers();
      if (eventBus) eventBus.emit("tools:text:activated", { source: meta?.source || "user" });
    },
    onDeactivate(meta) {
      detachPointerHandlers();
      hideEditor(true);
      if (eventBus) eventBus.emit("tools:text:deactivated", { source: meta?.source || "user" });
    },
    onOptionsChanged(next, previous) {
      if (activeEditing?.layerId) {
        // Update editor styles and layer metadata live
        applyEditorStyles(next);
        queueTextUpdateFromEditor(activeEditing.layerId, next);
      }
      if (eventBus) eventBus.emit("tools:text:options", { options: next, previous });
    },
    getPublicApi() {
      return {
        id: "text",
        startEditing: (layerId) => startEditingLayer(layerId),
        commit: () => commitEditing(),
        cancel: () => hideEditor(true),
        get options() {
          const options = store.getState().tools?.options?.text || {};
          return { ...options };
        },
      };
    },
  };

  let editorEl = null;
  let pointerDownHandler = null;
  let pointerMoveHandler = null;
  let pointerUpHandler = null;
  let viewportListenerCleanup = [];
  let activeEditing = null; // { layerId }

  function attachPointerHandlers() {
    const canvas = document.getElementById("workspace-canvas");
    if (!canvas) return;
    if (!editorEl) editorEl = ensureEditorContainer();

    pointerDownHandler = (e) => {
      // prevent viewport panning
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      const target = findTopTextLayerAt(world.x, world.y);
      if (target) {
        startEditingLayer(target.id);
      } else {
        createTextAt(world.x, world.y);
      }
    };
    canvas.addEventListener("pointerdown", pointerDownHandler, { capture: true });

    const onPanZoom = () => repositionEditor();
    viewportListenerCleanup.push(eventBus.on("viewport:pan", onPanZoom));
    viewportListenerCleanup.push(eventBus.on("viewport:zoom", onPanZoom));
    viewportListenerCleanup.push(eventBus.on("viewport:reset", onPanZoom));
  }

  function detachPointerHandlers() {
    const canvas = document.getElementById("workspace-canvas");
    if (canvas && pointerDownHandler) {
      try { canvas.removeEventListener("pointerdown", pointerDownHandler, { capture: true }); } catch (_) { canvas.removeEventListener("pointerdown", pointerDownHandler); }
    }
    pointerDownHandler = null;
    pointerMoveHandler = null;
    pointerUpHandler = null;
    viewportListenerCleanup.forEach((off) => { try { if (typeof off === "function") off(); } catch (_) {} });
    viewportListenerCleanup = [];
  }

  function findTopTextLayerAt(x, y) {
    const state = store.getState();
    const order = Array.isArray(state.layers?.order) ? state.layers.order : [];
    const entities = state.layers?.entities || {};
    for (let i = 0; i < order.length; i += 1) {
      const id = order[i];
      const layer = entities[id];
      if (!layer || layer.type !== "text") continue;
      const t = layer.transform || {};
      const d = layer.dimensions || {};
      const left = t.x || 0;
      const top = t.y || 0;
      const right = left + (d.width || 0) * (t.scaleX || 1);
      const bottom = top + (d.height || 0) * (t.scaleY || 1);
      if (x >= left && y >= top && x <= right && y <= bottom) {
        return { id };
      }
    }
    return null;
  }

  function createTextAt(x, y) {
    const opts = normaliseTextOptions(store.getState().tools?.options?.text || {});
    const definition = {
      type: "text",
      name: "Text",
      transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
      dimensions: { width: Math.max(64, Math.round(opts.fontSize * 6)), height: Math.max(32, Math.round(opts.fontSize * 1.4)) },
      metadata: {
        text: "",
        fontFamily: opts.fontFamily,
        fontSize: opts.fontSize,
        fontWeight: opts.fontWeight,
        align: opts.align,
        color: opts.color,
      },
    };
    let createdId = null;
    history.execute(TEXT_CREATE_COMMAND, { definition, meta: { source: "text-tool" } }, { meta: { tool: "text" } });
    // Newly created active layer is set by layerManager; get it
    createdId = store.getState().layers?.active;
    if (createdId) {
      startEditingLayer(createdId);
    }
  }

  function applyEditorStyles(options) {
    if (!editorEl) return;
    const opts = normaliseTextOptions(options || (store.getState().tools?.options?.text || {}));
    editorEl.style.font = buildFontCss(opts);
    editorEl.style.color = opts.color;
    editorEl.style.textAlign = opts.align;
  }

  function startEditingLayer(layerId) {
    const state = store.getState();
    const layer = state.layers?.entities?.[layerId];
    if (!layer || layer.type !== "text") return;
    if (!editorEl) editorEl = ensureEditorContainer();

    const t = layer.transform || {};
    const pos = computeScreenPointFromWorld(t.x || 0, t.y || 0);
    const opts = {
      fontFamily: layer.metadata?.fontFamily || DEFAULT_TEXT_OPTIONS.fontFamily,
      fontSize: layer.metadata?.fontSize || DEFAULT_TEXT_OPTIONS.fontSize,
      fontWeight: layer.metadata?.fontWeight || DEFAULT_TEXT_OPTIONS.fontWeight,
      align: layer.metadata?.align || DEFAULT_TEXT_OPTIONS.align,
      color: layer.metadata?.color || DEFAULT_TEXT_OPTIONS.color,
    };

    editorEl.hidden = false;
    editorEl.style.left = `${pos.x}px`;
    editorEl.style.top = `${pos.y}px`;
    editorEl.style.transform = `translateZ(0)`;
    applyEditorStyles(opts);

    editorEl.textContent = String(layer.metadata?.text || "");
    activeEditing = { layerId };

    // Size: use layer dimensions scaled by zoom for visual parity
    const zoom = pos.zoom || 1;
    editorEl.style.width = `${Math.max(8, (layer.dimensions?.width || 0) * zoom)}px`;
    editorEl.style.minHeight = `${Math.max(1, (layer.dimensions?.height || 0) * zoom)}px`;

    // Ensure focus after slight delay for iOS
    setTimeout(() => {
      try { editorEl.focus(); } catch (_) {}
      selectEnd(editorEl);
    }, 0);

    // Bind input events once
    if (!editorEl.__m8_bound__) {
      editorEl.addEventListener("input", () => {
        if (!activeEditing?.layerId) return;
        queueTextUpdateFromEditor(activeEditing.layerId);
      });
      editorEl.addEventListener("blur", () => {
        commitEditing();
      });
      editorEl.__m8_bound__ = true;
    }
  }

  function repositionEditor() {
    if (!editorEl || editorEl.hidden || !activeEditing?.layerId) return;
    const layerId = activeEditing.layerId;
    const st = store.getState();
    const layer = st.layers?.entities?.[layerId];
    if (!layer) return;
    const t = layer.transform || {};
    const pos = computeScreenPointFromWorld(t.x || 0, t.y || 0);
    editorEl.style.left = `${pos.x}px`;
    editorEl.style.top = `${pos.y}px`;
    // Update width/height to reflect zoom changes
    const zoom = pos.zoom || 1;
    editorEl.style.width = `${Math.max(8, (layer.dimensions?.width || 0) * zoom)}px`;
    editorEl.style.minHeight = `${Math.max(1, (layer.dimensions?.height || 0) * zoom)}px`;

    // Scale font based on zoom to match canvas rendering
    const options = store.getState().tools?.options?.text || {};
    applyEditorStyles(options);
  }

  let updateTimer = null;
  function queueTextUpdateFromEditor(layerId, optionsOverride) {
    // debounce small coalesce window to avoid spamming history
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    updateTimer = setTimeout(() => {
      updateTimer = null;
      commitTextSnapshot(layerId, optionsOverride);
    }, 60);
  }

  function commitTextSnapshot(layerId, optionsOverride) {
    if (!editorEl) return;
    const text = editorEl.textContent || "";
    const currentOptions = normaliseTextOptions(optionsOverride || (store.getState().tools?.options?.text || {}));
    const zoom = clampZoom(store.getState().viewport?.zoom ?? 1, store.getState().viewport?.minZoom, store.getState().viewport?.maxZoom);
    const { width, height } = measureEditor(editorEl, zoom);
    const changes = {
      metadata: {
        text,
        fontFamily: currentOptions.fontFamily,
        fontSize: currentOptions.fontSize,
        fontWeight: currentOptions.fontWeight,
        align: currentOptions.align,
        color: currentOptions.color,
      },
      dimensions: { width, height },
    };
    history.execute(
      TEXT_UPDATE_COMMAND,
      { layerId, changes, options: { source: "text-tool", coalesceWindow: 900 } },
      { meta: { tool: "text", layerId } }
    );
  }

  function commitEditing() {
    if (!activeEditing?.layerId || !editorEl) return;
    commitTextSnapshot(activeEditing.layerId);
    hideEditor(false);
  }

  function hideEditor(cancel) {
    if (editorEl) {
      editorEl.hidden = true;
      editorEl.blur();
    }
    if (cancel) {
      // No-op for now
    }
    activeEditing = null;
  }

  function selectEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  return api;
}
