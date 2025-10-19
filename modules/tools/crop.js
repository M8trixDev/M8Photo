import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { clampZoom } from "../view/viewport.js";

const CROP_APPLY_COMMAND = "tool:crop:apply";

const DEFAULT_CROP_OPTIONS = Object.freeze({
  showGuides: true,
  constrainAspect: false,
  aspectRatio: null, // e.g., 16/9
});

function normaliseCropOptions(options = {}) {
  const next = { ...DEFAULT_CROP_OPTIONS, ...(options || {}) };
  next.showGuides = next.showGuides !== false;
  next.constrainAspect = Boolean(next.constrainAspect);
  const ar = Number(next.aspectRatio);
  next.aspectRatio = Number.isFinite(ar) && ar > 0 ? ar : null;
  return next;
}

function computeWorkspacePointFromEvent(event) {
  const canvas = document.getElementById("workspace-canvas");
  if (!canvas) return { x: 0, y: 0 };
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

function worldToScreen(x, y) {
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

function ensureOverlay() {
  const stage = document.querySelector("[data-viewport-stage]");
  if (!stage) return null;
  let overlay = stage.querySelector("[data-crop-overlay]");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.setAttribute("data-crop-overlay", "");
    overlay.className = "crop-overlay";
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "0";
    overlay.style.pointerEvents = "none";

    // Mask outside box
    const mask = document.createElement("div");
    mask.className = "crop-overlay__mask";
    mask.style.position = "absolute";
    mask.style.inset = "0";
    mask.style.background = "rgba(0,0,0,0.45)";
    mask.style.pointerEvents = "none";

    const box = document.createElement("div");
    box.className = "crop-overlay__box";
    box.style.position = "absolute";
    box.style.border = "1px solid rgba(255,255,255,0.85)";
    box.style.outline = "9999px solid rgba(0,0,0,0.45)"; // Fake mask by huge outline
    box.style.boxSizing = "content-box";

    const guides = document.createElement("div");
    guides.className = "crop-overlay__guides";
    guides.style.position = "absolute";
    guides.style.inset = "0";
    guides.style.pointerEvents = "none";

    overlay.appendChild(mask);
    overlay.appendChild(box);
    overlay.appendChild(guides);
    stage.appendChild(overlay);
  }
  return overlay;
}

function renderGuides(guidesEl, rectPx) {
  if (!guidesEl) return;
  guidesEl.innerHTML = "";
  const line = () => {
    const d = document.createElement("div");
    d.style.position = "absolute";
    d.style.background = "rgba(255,255,255,0.35)";
    return d;
  };
  const thirdW = rectPx.width / 3;
  const thirdH = rectPx.height / 3;
  // Vertical lines
  const v1 = line(); v1.style.left = `${Math.round(thirdW)}px`; v1.style.top = "0"; v1.style.bottom = "0"; v1.style.width = "1px";
  const v2 = line(); v2.style.left = `${Math.round(thirdW * 2)}px`; v2.style.top = "0"; v2.style.bottom = "0"; v2.style.width = "1px";
  // Horizontal lines
  const h1 = line(); h1.style.top = `${Math.round(thirdH)}px`; h1.style.left = "0"; h1.style.right = "0"; h1.style.height = "1px";
  const h2 = line(); h2.style.top = `${Math.round(thirdH * 2)}px`; h2.style.left = "0"; h2.style.right = "0"; h2.style.height = "1px";
  guidesEl.appendChild(v1); guidesEl.appendChild(v2); guidesEl.appendChild(h1); guidesEl.appendChild(h2);
}

function registerCropCommand() {
  if (history.hasCommand(CROP_APPLY_COMMAND)) return;
  history.registerCommand(CROP_APPLY_COMMAND, ({ payload }) => {
    const rect = payload?.rect || { x: 0, y: 0, width: 0, height: 0 };
    const label = payload?.label || "Crop";
    let beforeState = null;
    return {
      type: CROP_APPLY_COMMAND,
      label,
      meta: { tool: "crop" },
      execute({ store: sharedStore }) {
        const state = sharedStore.getState();
        beforeState = {
          viewport: { ...(state.viewport || {}) },
          layers: JSON.parse(JSON.stringify(state.layers || {})),
          selection: { ...(state.selection || {}) },
        };
        // Apply crop: update viewport size and shift layer transforms
        sharedStore.updateSlice(
          "viewport",
          (vp) => ({
            ...vp,
            size: { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
            pan: { x: 0, y: 0 },
          }),
          { reason: "tools:crop-viewport" }
        );
        sharedStore.updateSlice(
          "layers",
          (layers) => {
            const entities = { ...layers.entities };
            Object.keys(entities).forEach((id) => {
              const layer = entities[id];
              const t = layer.transform || {};
              entities[id] = {
                ...layer,
                transform: { ...t, x: (t.x || 0) - rect.x, y: (t.y || 0) - rect.y },
                updatedAt: Date.now(),
              };
            });
            return { ...layers, entities };
          },
          { reason: "tools:crop-layers" }
        );
        if (eventBus) eventBus.emit("tools:crop:applied", { rect });
        return rect;
      },
      undo({ store: sharedStore }) {
        if (!beforeState) return null;
        sharedStore.replace({
          ...sharedStore.getState(),
          viewport: beforeState.viewport,
          layers: beforeState.layers,
          selection: beforeState.selection,
        }, { reason: "tools:crop-undo" });
        if (eventBus) eventBus.emit("tools:crop:undo", { rect });
        return rect;
      },
      redo({ store: sharedStore }) {
        // Re-apply
        sharedStore.updateSlice(
          "viewport",
          (vp) => ({
            ...vp,
            size: { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
            pan: { x: 0, y: 0 },
          }),
          { reason: "tools:crop-viewport" }
        );
        sharedStore.updateSlice(
          "layers",
          (layers) => {
            const entities = { ...layers.entities };
            Object.keys(entities).forEach((id) => {
              const layer = entities[id];
              const t = layer.transform || {};
              entities[id] = {
                ...layer,
                transform: { ...t, x: (t.x || 0) - rect.x, y: (t.y || 0) - rect.y },
                updatedAt: Date.now(),
              };
            });
            return { ...layers, entities };
          },
          { reason: "tools:crop-layers" }
        );
        if (eventBus) eventBus.emit("tools:crop:applied", { rect, redo: true });
        return rect;
      },
    };
  });
}

export function createCropTool(context = {}) {
  registerCropCommand();

  let overlayEl = null;
  let boxEl = null;
  let guidesEl = null;
  let active = false;
  let hasRect = false;
  let rect = { x: 0, y: 0, width: 0, height: 0 };
  let dragState = null; // { startX, startY }
  let pointerDownHandler = null;
  let pointerMoveHandler = null;
  let pointerUpHandler = null;
  let viewportListenerCleanup = [];

  function ensureUi() {
    if (!overlayEl) overlayEl = ensureOverlay();
    if (!overlayEl) return;
    boxEl = overlayEl.querySelector(".crop-overlay__box");
    guidesEl = overlayEl.querySelector(".crop-overlay__guides");
  }

  function onPanZoom() {
    render();
  }

  function attachPointer() {
    const canvas = document.getElementById("workspace-canvas");
    if (!canvas) return;
    ensureUi();
    overlayEl.style.display = "block";

    pointerDownHandler = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      dragState = { startX: world.x, startY: world.y };
      hasRect = true;
      rect = { x: world.x, y: world.y, width: 1, height: 1 };
      render();
    };
    pointerMoveHandler = (e) => {
      if (!dragState) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      const opts = normaliseCropOptions(store.getState().tools?.options?.crop || {});
      let w = world.x - dragState.startX;
      let h = world.y - dragState.startY;
      if (opts.constrainAspect && opts.aspectRatio) {
        const signW = w < 0 ? -1 : 1;
        const signH = h < 0 ? -1 : 1;
        const absW = Math.abs(w);
        const absH = Math.abs(h);
        if (absW / absH > opts.aspectRatio) {
          h = signH * (absW / opts.aspectRatio);
        } else {
          w = signW * (absH * opts.aspectRatio);
        }
      }
      rect = {
        x: Math.min(dragState.startX, dragState.startX + w),
        y: Math.min(dragState.startY, dragState.startY + h),
        width: Math.abs(w),
        height: Math.abs(h),
      };
      render();
    };
    pointerUpHandler = (e) => {
      if (!dragState) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dragState = null;
      render();
    };

    canvas.addEventListener("pointerdown", pointerDownHandler, { capture: true });
    canvas.addEventListener("pointermove", pointerMoveHandler, { capture: true });
    canvas.addEventListener("pointerup", pointerUpHandler, { capture: true });

    viewportListenerCleanup.push(eventBus.on("viewport:pan", onPanZoom));
    viewportListenerCleanup.push(eventBus.on("viewport:zoom", onPanZoom));
    viewportListenerCleanup.push(eventBus.on("viewport:reset", onPanZoom));
  }

  function detachPointer() {
    const canvas = document.getElementById("workspace-canvas");
    if (canvas && pointerDownHandler) {
      try { canvas.removeEventListener("pointerdown", pointerDownHandler, { capture: true }); } catch (_) { canvas.removeEventListener("pointerdown", pointerDownHandler); }
      try { canvas.removeEventListener("pointermove", pointerMoveHandler, { capture: true }); } catch (_) { canvas.removeEventListener("pointermove", pointerMoveHandler); }
      try { canvas.removeEventListener("pointerup", pointerUpHandler, { capture: true }); } catch (_) { canvas.removeEventListener("pointerup", pointerUpHandler); }
    }
    pointerDownHandler = null;
    pointerMoveHandler = null;
    pointerUpHandler = null;
    viewportListenerCleanup.forEach((off) => { try { if (typeof off === "function") off(); } catch (_) {} });
    viewportListenerCleanup = [];
    if (overlayEl) overlayEl.style.display = "none";
  }

  function render() {
    ensureUi();
    if (!overlayEl || !boxEl) return;
    if (!hasRect) {
      boxEl.style.display = "none";
      guidesEl.innerHTML = "";
      return;
    }
    boxEl.style.display = "block";
    const p1 = worldToScreen(rect.x, rect.y);
    const p2 = worldToScreen(rect.x + rect.width, rect.y + rect.height);
    const left = Math.min(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const width = Math.abs(p2.x - p1.x);
    const height = Math.abs(p2.y - p1.y);
    boxEl.style.left = `${Math.round(left)}px`;
    boxEl.style.top = `${Math.round(top)}px`;
    boxEl.style.width = `${Math.round(width)}px`;
    boxEl.style.height = `${Math.round(height)}px`;

    guidesEl.style.left = boxEl.style.left;
    guidesEl.style.top = boxEl.style.top;
    guidesEl.style.width = boxEl.style.width;
    guidesEl.style.height = boxEl.style.height;
    const opts = normaliseCropOptions(store.getState().tools?.options?.crop || {});
    guidesEl.style.display = opts.showGuides ? "block" : "none";
    if (opts.showGuides) renderGuides(guidesEl, { width, height });
  }

  function apply() {
    if (!hasRect || rect.width < 2 || rect.height < 2) return null;
    const vpSize = store.getState().viewport?.size || { width: 0, height: 0 };
    const clamped = {
      x: Math.max(0, Math.min(Math.round(rect.x), Math.max(0, vpSize.width - 1))),
      y: Math.max(0, Math.min(Math.round(rect.y), Math.max(0, vpSize.height - 1))),
      width: Math.max(1, Math.min(Math.round(rect.width), vpSize.width)),
      height: Math.max(1, Math.min(Math.round(rect.height), vpSize.height)),
    };
    const result = history.execute(CROP_APPLY_COMMAND, { rect: clamped }, { meta: { tool: "crop" } });
    cancel();
    return result;
  }

  function cancel() {
    hasRect = false;
    rect = { x: 0, y: 0, width: 0, height: 0 };
    render();
  }

  return {
    id: "crop",
    label: "Crop",
    cursor: "crosshair",
    getDefaultOptions() { return { ...DEFAULT_CROP_OPTIONS }; },
    normalizeOptions(next = {}) { return normaliseCropOptions(next); },
    onActivate(meta) { active = true; attachPointer(); if (eventBus) eventBus.emit("tools:crop:activated", { source: meta?.source || "user" }); },
    onDeactivate(meta) { active = false; detachPointer(); if (eventBus) eventBus.emit("tools:crop:deactivated", { source: meta?.source || "user" }); },
    onOptionsChanged() { render(); },
    getPublicApi() {
      return {
        id: "crop",
        apply,
        cancel,
        hasSelection: () => hasRect && rect.width > 1 && rect.height > 1,
        get options() {
          const options = store.getState().tools?.options?.crop || {};
          return { ...options };
        },
      };
    },
    apply,
    cancel,
  };
}
