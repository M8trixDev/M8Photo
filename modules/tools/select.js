import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { getCanvas as getAssetCanvas, registerCanvas as registerAssetCanvas } from "../io/assetStore.js";
import { layerManager } from "../layers/layerManager.js";

const SELECT_SET_COMMAND = "selection:set-region";
const SELECT_CLEAR_COMMAND = "selection:clear-region";
const SELECT_CLEAR_PIXELS_COMMAND = "selection:clear-pixels";
const SELECT_FILL_PIXELS_COMMAND = "selection:fill-pixels";

const DEFAULT_SELECT_OPTIONS = Object.freeze({
  selectionMode: "replace", // replace | add | subtract | intersect
});

function clamp(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampRectToViewport(rect) {
  const vp = store.getState().viewport || {};
  const size = vp.size || { width: 0, height: 0 };
  const x = clamp(Math.round(rect.x), 0, Math.max(0, (size.width || 0)));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, (size.height || 0)));
  const w = clamp(Math.round(rect.width), 0, Math.max(0, (size.width || 0)));
  const h = clamp(Math.round(rect.height), 0, Math.max(0, (size.height || 0)));
  const x2 = clamp(x + w, 0, Math.max(0, (size.width || 0)));
  const y2 = clamp(y + h, 0, Math.max(0, (size.height || 0)));
  return { x: Math.min(x, x2), y: Math.min(y, y2), width: Math.abs(x2 - x), height: Math.abs(y2 - y) };
}

function rectArea(r) { return Math.max(0, r.width) * Math.max(0, r.height); }

function intersectRects(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function unionRects(a, b) {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function subtractRects(a, b) {
  // Returns the largest remaining rectangle from subtracting b from a (simple heuristic)
  const inter = intersectRects(a, b);
  if (rectArea(inter) === 0) return { ...a };
  // Four candidate rectangles around the intersection
  const candidates = [];
  // Top strip
  if (inter.y > a.y) {
    candidates.push({ x: a.x, y: a.y, width: a.width, height: inter.y - a.y });
  }
  // Bottom strip
  if (inter.y + inter.height < a.y + a.height) {
    candidates.push({ x: a.x, y: inter.y + inter.height, width: a.width, height: a.y + a.height - (inter.y + inter.height) });
  }
  // Left strip
  if (inter.x > a.x) {
    candidates.push({ x: a.x, y: inter.y, width: inter.x - a.x, height: inter.height });
  }
  // Right strip
  if (inter.x + inter.width < a.x + a.width) {
    candidates.push({ x: inter.x + inter.width, y: inter.y, width: a.x + a.width - (inter.x + inter.width), height: inter.height });
  }
  if (!candidates.length) return { x: 0, y: 0, width: 0, height: 0 };
  candidates.sort((r1, r2) => rectArea(r2) - rectArea(r1));
  return candidates[0];
}

function normaliseRect(rect) {
  if (!rect || typeof rect !== "object") return { x: 0, y: 0, width: 0, height: 0 };
  const x = Number(rect.x) || 0;
  const y = Number(rect.y) || 0;
  const w = Math.max(0, Number(rect.width) || 0);
  const h = Math.max(0, Number(rect.height) || 0);
  return { x, y, width: w, height: h };
}

function computeWorkspacePointFromEvent(event) {
  const canvas = document.getElementById("workspace-canvas");
  if (!canvas) return { x: 0, y: 0 };
  const viewport = store.getState().viewport || {};
  const zoom = Math.min(Math.max(viewport.zoom ?? 1, viewport.minZoom ?? 0.1), viewport.maxZoom ?? 8);
  const workspaceWidth = viewport.size?.width || canvas.clientWidth || 1;
  const workspaceHeight = viewport.size?.height || canvas.clientHeight || 1;
  const pan = viewport.pan || { x: 0, y: 0 };
  const baseX = (canvas.clientWidth - workspaceWidth * zoom) / 2;
  const baseY = (canvas.clientHeight - workspaceHeight * zoom) / 2;
  const translateX = baseX + pan.x;
  const translateY = baseY + pan.y;
  const offsetX = typeof event.offsetX === "number" ? event.offsetX : event.clientX - canvas.getBoundingClientRect().left;
  const offsetY = typeof event.offsetY === "number" ? event.offsetY : event.clientY - canvas.getBoundingClientRect().top;
  const worldX = (offsetX - translateX) / zoom;
  const worldY = (offsetY - translateY) / zoom;
  return { x: worldX, y: worldY };
}

function worldToScreen(x, y) {
  const canvas = document.getElementById("workspace-canvas");
  if (!canvas) return { x: 0, y: 0, zoom: 1 };
  const viewport = store.getState().viewport || {};
  const zoom = Math.min(Math.max(viewport.zoom ?? 1, viewport.minZoom ?? 0.1), viewport.maxZoom ?? 8);
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
  let overlay = stage.querySelector("[data-select-overlay]");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.setAttribute("data-select-overlay", "");
    overlay.className = "select-overlay";
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "0";
    overlay.style.pointerEvents = "none";

    const box = document.createElement("div");
    box.className = "select-overlay__box";
    box.style.position = "absolute";
    box.style.boxSizing = "border-box";
    box.style.pointerEvents = "none";

    const edges = {
      top: document.createElement("div"),
      right: document.createElement("div"),
      bottom: document.createElement("div"),
      left: document.createElement("div"),
    };

    const initEdge = (el, direction) => {
      el.className = `select-overlay__edge select-overlay__edge--${direction}`;
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      el.style.backgroundSize = "8px 8px";
      el.style.backgroundRepeat = "repeat";
      el.style.willChange = "background-position";
      el.style.animation = "m8photo-ants 500ms linear infinite";
      if (direction === "top" || direction === "bottom") {
        el.style.height = "2px";
        el.style.left = "0";
        el.style.right = "0";
        el.style.backgroundImage = "repeating-linear-gradient(90deg, rgba(255,255,255,0.9) 0 4px, rgba(0,0,0,0.85) 4px 8px)";
      } else {
        el.style.width = "2px";
        el.style.top = "0";
        el.style.bottom = "0";
        el.style.backgroundImage = "repeating-linear-gradient(0deg, rgba(255,255,255,0.9) 0 4px, rgba(0,0,0,0.85) 4px 8px)";
      }
    };

    initEdge(edges.top, "top");
    initEdge(edges.right, "right");
    initEdge(edges.bottom, "bottom");
    initEdge(edges.left, "left");

    box.appendChild(edges.top);
    box.appendChild(edges.right);
    box.appendChild(edges.bottom);
    box.appendChild(edges.left);

    // Keyframes (inserted once)
    if (!document.getElementById("m8photo-ants-style")) {
      const style = document.createElement("style");
      style.id = "m8photo-ants-style";
      style.textContent = `@keyframes m8photo-ants { from { background-position: 0 0; } to { background-position: 8px 0; } }`;
      document.head.appendChild(style);
    }

    overlay.appendChild(box);
    stage.appendChild(overlay);
  }
  return overlay;
}

function getOverlayElements() {
  const overlay = ensureOverlay();
  if (!overlay) return { overlay: null, box: null, edges: null };
  const box = overlay.querySelector(".select-overlay__box");
  const edges = {
    top: overlay.querySelector(".select-overlay__edge--top"),
    right: overlay.querySelector(".select-overlay__edge--right"),
    bottom: overlay.querySelector(".select-overlay__edge--bottom"),
    left: overlay.querySelector(".select-overlay__edge--left"),
  };
  return { overlay, box, edges };
}

function renderOverlay() {
  const { overlay, box, edges } = getOverlayElements();
  if (!overlay || !box) return;
  const selection = store.getState().selection || {};
  const region = selection.region || null;
  if (!region || region.width <= 0 || region.height <= 0) {
    box.style.display = "none";
    return;
  }
  const p1 = worldToScreen(region.x, region.y);
  const p2 = worldToScreen(region.x + region.width, region.y + region.height);
  const left = Math.min(p1.x, p2.x);
  const top = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);
  box.style.display = "block";
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
  box.style.width = `${Math.round(width)}px`;
  box.style.height = `${Math.round(height)}px`;
  if (edges.top) edges.top.style.top = "0";
  if (edges.bottom) edges.bottom.style.bottom = "0";
  if (edges.left) edges.left.style.left = "0";
  if (edges.right) edges.right.style.right = "0";
}

function registerSelectionCommands() {
  if (!history.hasCommand(SELECT_SET_COMMAND)) {
    history.registerCommand(SELECT_SET_COMMAND, ({ payload }) => {
      const mode = String(payload?.mode || "replace").toLowerCase();
      const rect = clampRectToViewport(normaliseRect(payload?.rect || {}));
      return {
        type: SELECT_SET_COMMAND,
        label: "Set Selection",
        meta: { tool: "select", mode },
        mode,
        rect,
        before: null,
        after: null,
        execute({ store: sharedStore }) {
          const prev = sharedStore.getState().selection?.region || null;
          const next = mergeRegion(prev, rect, mode);
          this.before = prev ? { ...prev } : null;
          this.after = next ? { ...next } : null;
          sharedStore.updateSlice(
            "selection",
            (sel) => ({ ...sel, region: next }),
            { reason: "selection:set-region", tool: "select" }
          );
          if (eventBus) eventBus.emit("selection:change", { region: next, mode });
          renderOverlay();
          return next;
        },
        undo({ store: sharedStore }) {
          const prev = this.before ? { ...this.before } : null;
          sharedStore.updateSlice(
            "selection",
            (sel) => ({ ...sel, region: prev }),
            { reason: "selection:undo", tool: "select" }
          );
          if (eventBus) eventBus.emit("selection:change", { region: prev, undo: true });
          renderOverlay();
          return prev;
        },
        redo({ store: sharedStore }) {
          const next = this.after ? { ...this.after } : null;
          sharedStore.updateSlice(
            "selection",
            (sel) => ({ ...sel, region: next }),
            { reason: "selection:redo", tool: "select" }
          );
          if (eventBus) eventBus.emit("selection:change", { region: next, redo: true });
          renderOverlay();
          return next;
        },
      };
    });
  }

  if (!history.hasCommand(SELECT_CLEAR_COMMAND)) {
    history.registerCommand(SELECT_CLEAR_COMMAND, () => {
      return {
        type: SELECT_CLEAR_COMMAND,
        label: "Deselect",
        meta: { tool: "select" },
        before: null,
        execute({ store: sharedStore }) {
          const prev = sharedStore.getState().selection?.region || null;
          this.before = prev ? { ...prev } : null;
          sharedStore.updateSlice(
            "selection",
            (sel) => ({ ...sel, region: null }),
            { reason: "selection:clear", tool: "select" }
          );
          if (eventBus) eventBus.emit("selection:change", { region: null });
          renderOverlay();
          return null;
        },
        undo({ store: sharedStore }) {
          const prev = this.before ? { ...this.before } : null;
          sharedStore.updateSlice(
            "selection",
            (sel) => ({ ...sel, region: prev }),
            { reason: "selection:undo", tool: "select" }
          );
          if (eventBus) eventBus.emit("selection:change", { region: prev, undo: true });
          renderOverlay();
          return prev;
        },
        redo({ store: sharedStore }) {
          sharedStore.updateSlice(
            "selection",
            (sel) => ({ ...sel, region: null }),
            { reason: "selection:redo", tool: "select" }
          );
          if (eventBus) eventBus.emit("selection:change", { region: null, redo: true });
          renderOverlay();
          return null;
        },
      };
    });
  }

  if (!history.hasCommand(SELECT_CLEAR_PIXELS_COMMAND)) {
    history.registerCommand(SELECT_CLEAR_PIXELS_COMMAND, ({ payload }) => {
      return {
        type: SELECT_CLEAR_PIXELS_COMMAND,
        label: "Clear Selection",
        meta: { tool: "select" },
        layerId: payload?.layerId || null,
        region: null,
        beforeImageData: null,
        execute() {
          const state = store.getState();
          const targetLayerId = this.layerId || state.layers?.active;
          const layer = targetLayerId ? state.layers?.entities?.[targetLayerId] : null;
          const region = state.selection?.region || null;
          if (!layer || !region || region.width <= 0 || region.height <= 0) return null;
          const canvas = ensureLayerAssetCanvas(layer);
          const ctx = canvas.getContext("2d");
          const localRect = worldRectToLayerLocal(region, layer);
          const x = Math.max(0, Math.floor(localRect.x));
          const y = Math.max(0, Math.floor(localRect.y));
          const w = Math.max(0, Math.floor(localRect.width));
          const h = Math.max(0, Math.floor(localRect.height));
          this.region = { x, y, width: w, height: h };
          const img = ctx.getImageData(x, y, w, h);
          this.beforeImageData = img.data.slice();
          // Clear
          ctx.clearRect(x, y, w, h);
          if (eventBus) eventBus.emit("selection:clearPixels", { layerId: layer.id, region: this.region });
          return this.region;
        },
        undo() {
          if (!this.beforeImageData || !this.region) return null;
          const state = store.getState();
          const layer = state.layers?.entities?.[this.layerId || state.layers?.active];
          if (!layer) return null;
          const meta = layer.metadata || {};
          const canvas = getAssetCanvas(meta.imageAssetId);
          if (!canvas) return null;
          const ctx = canvas.getContext("2d");
          const { x, y, width, height } = this.region;
          const img = ctx.getImageData(x, y, width, height);
          if (this.beforeImageData.length === img.data.length) {
            img.data.set(this.beforeImageData);
            ctx.putImageData(img, x, y);
          }
          if (eventBus) eventBus.emit("selection:clearPixels:undo", { layerId: layer.id, region: this.region });
          return true;
        },
        redo() {
          // Re-clear
          const state = store.getState();
          const layer = state.layers?.entities?.[this.layerId || state.layers?.active];
          if (!layer || !this.region) return null;
          const canvas = ensureLayerAssetCanvas(layer);
          const ctx = canvas.getContext("2d");
          ctx.clearRect(this.region.x, this.region.y, this.region.width, this.region.height);
          if (eventBus) eventBus.emit("selection:clearPixels", { layerId: layer.id, region: this.region, redo: true });
          return true;
        },
      };
    });
  }

  if (!history.hasCommand(SELECT_FILL_PIXELS_COMMAND)) {
    history.registerCommand(SELECT_FILL_PIXELS_COMMAND, ({ payload }) => {
      const fillColor = typeof payload?.fillColor === "string" && payload.fillColor.trim() !== "" ? payload.fillColor.trim() : null;
      const opacity = typeof payload?.opacity === "number" ? Math.max(0, Math.min(1, payload.opacity)) : 1;
      return {
        type: SELECT_FILL_PIXELS_COMMAND,
        label: "Fill Selection",
        meta: { tool: "select" },
        layerId: payload?.layerId || null,
        fillColor,
        opacity,
        region: null,
        beforeImageData: null,
        execute() {
          const state = store.getState();
          const targetLayerId = this.layerId || state.layers?.active;
          const layer = targetLayerId ? state.layers?.entities?.[targetLayerId] : null;
          const region = state.selection?.region || null;
          if (!layer || !region || region.width <= 0 || region.height <= 0) return null;
          const canvas = ensureLayerAssetCanvas(layer);
          const ctx = canvas.getContext("2d");
          const localRect = worldRectToLayerLocal(region, layer);
          const x = Math.max(0, Math.floor(localRect.x));
          const y = Math.max(0, Math.floor(localRect.y));
          const w = Math.max(0, Math.floor(localRect.width));
          const h = Math.max(0, Math.floor(localRect.height));
          this.region = { x, y, width: w, height: h };
          const img = ctx.getImageData(x, y, w, h);
          this.beforeImageData = img.data.slice();
          // Fill
          const color = this.fillColor || (store.getState().ui?.color?.hex || "#000000");
          ctx.save();
          ctx.globalAlpha = this.opacity;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, w, h);
          ctx.restore();
          if (eventBus) eventBus.emit("selection:fillPixels", { layerId: layer.id, region: this.region, color, opacity: this.opacity });
          return this.region;
        },
        undo() {
          if (!this.beforeImageData || !this.region) return null;
          const state = store.getState();
          const layer = state.layers?.entities?.[this.layerId || state.layers?.active];
          if (!layer) return null;
          const meta = layer.metadata || {};
          const canvas = getAssetCanvas(meta.imageAssetId);
          if (!canvas) return null;
          const ctx = canvas.getContext("2d");
          const { x, y, width, height } = this.region;
          const img = ctx.getImageData(x, y, width, height);
          if (this.beforeImageData.length === img.data.length) {
            img.data.set(this.beforeImageData);
            ctx.putImageData(img, x, y);
          }
          if (eventBus) eventBus.emit("selection:fillPixels:undo", { layerId: layer.id, region: this.region });
          return true;
        },
        redo() {
          // Re-fill
          const state = store.getState();
          const layer = state.layers?.entities?.[this.layerId || state.layers?.active];
          if (!layer || !this.region) return null;
          const meta = layer.metadata || {};
          let canvas = getAssetCanvas(meta.imageAssetId);
          if (!canvas) canvas = ensureLayerAssetCanvas(layer);
          const ctx = canvas.getContext("2d");
          const color = this.fillColor || (store.getState().ui?.color?.hex || "#000000");
          ctx.save();
          ctx.globalAlpha = this.opacity;
          ctx.fillStyle = color;
          ctx.fillRect(this.region.x, this.region.y, this.region.width, this.region.height);
          ctx.restore();
          if (eventBus) eventBus.emit("selection:fillPixels", { layerId: layer.id, region: this.region, color, opacity: this.opacity, redo: true });
          return true;
        },
      };
    });
  }
}

function mergeRegion(previous, next, mode) {
  const a = previous && previous.width > 0 && previous.height > 0 ? previous : null;
  const b = next && next.width > 0 && next.height > 0 ? next : null;
  if (!a && !b) return null;
  if (!a) return { ...b };
  if (!b) return mode === "subtract" || mode === "intersect" ? { ...a } : { ...a };
  switch (mode) {
    case "add":
      return unionRects(a, b);
    case "subtract":
      return subtractRects(a, b);
    case "intersect":
      return intersectRects(a, b);
    case "replace":
    default:
      return { ...b };
  }
}

function ensureLayerAssetCanvas(layer) {
  const meta = layer.metadata || {};
  const dims = layer.dimensions || {};
  const width = Math.max(1, Math.round(dims.width || 1));
  const height = Math.max(1, Math.round(dims.height || 1));
  let canvas = null;
  if (typeof meta.imageAssetId === "string") {
    canvas = getAssetCanvas(meta.imageAssetId);
  }
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const id = registerAssetCanvas(canvas, { prefix: "image", ownerId: layer.id, mimeType: "image/png" });
    layerManager.updateLayer(layer.id, { metadata: { ...meta, imageAssetId: id } }, { source: "select-tool" });
  } else {
    if (canvas.width !== width || canvas.height !== height) {
      const tmp = document.createElement("canvas");
      tmp.width = width;
      tmp.height = height;
      const tctx = tmp.getContext("2d");
      try { tctx.drawImage(canvas, 0, 0, width, height); } catch (_) {}
      const id = registerAssetCanvas(tmp, { prefix: "image", ownerId: layer.id, mimeType: "image/png" });
      layerManager.updateLayer(layer.id, { metadata: { ...meta, imageAssetId: id } }, { source: "select-tool" });
      canvas = tmp;
    }
  }
  return canvas;
}

function worldRectToLayerLocal(rect, layer) {
  // Transform world-space rect to layer-local axis-aligned bounding box
  const p1 = worldToLayerLocalPt(rect.x, rect.y, layer);
  const p2 = worldToLayerLocalPt(rect.x + rect.width, rect.y + rect.height, layer);
  const left = Math.min(p1.x, p2.x);
  const top = Math.min(p1.y, p2.y);
  const right = Math.max(p1.x, p2.x);
  const bottom = Math.max(p1.y, p2.y);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function worldToLayerLocalPt(worldX, worldY, layer) {
  const t = layer.transform || {};
  const d = layer.dimensions || {};
  const width = d.width || 0;
  const height = d.height || 0;
  const scaleX = typeof t.scaleX === "number" ? t.scaleX : 1;
  const scaleY = typeof t.scaleY === "number" ? t.scaleY : 1;
  const rotation = ((typeof t.rotation === "number" ? t.rotation : 0) * Math.PI) / 180;

  // Translate into layer space
  let x = worldX - (t.x || 0);
  let y = worldY - (t.y || 0);

  // Un-rotate around layer center
  if (Math.abs(rotation) > 1e-6) {
    const cx = width / 2;
    const cy = height / 2;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = x - cx;
    const dy = y - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    x = rx + cx;
    y = ry + cy;
  }

  // Un-scale
  if (scaleX !== 0) x /= scaleX;
  if (scaleY !== 0) y /= scaleY;

  return { x, y };
}

export function createSelectTool(context = {}) {
  registerSelectionCommands();

  let active = false;
  let drag = null; // { startX, startY }
  let pointerDownHandler = null;
  let pointerMoveHandler = null;
  let pointerUpHandler = null;
  let keyHandler = null;
  let cancelListener = null;
  let viewportListenerCleanup = [];

  function attachPointer() {
    const canvas = document.getElementById("workspace-canvas");
    if (!canvas) return;

    const { overlay } = getOverlayElements();
    if (overlay) overlay.style.display = "block";

    pointerDownHandler = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      drag = { startX: world.x, startY: world.y };
      // Render live rect
      const { box } = getOverlayElements();
      if (box) box.style.display = "block";
      updatePreview(world.x, world.y, e);
    };

    pointerMoveHandler = (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      updatePreview(world.x, world.y, e);
    };

    pointerUpHandler = (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      const rect = buildRectFromDrag(drag.startX, drag.startY, world.x, world.y);
      drag = null;
      const mode = resolveModifierMode(e);
      const payload = { rect: clampRectToViewport(rect), mode };
      history.execute(SELECT_SET_COMMAND, payload, { meta: { tool: "select", mode } });
    };

    canvas.addEventListener("pointerdown", pointerDownHandler, { capture: true });
    canvas.addEventListener("pointermove", pointerMoveHandler, { capture: true });
    canvas.addEventListener("pointerup", pointerUpHandler, { capture: true });

    // Cancel current drag on Escape or tools:cancel
    keyHandler = (e) => {
      if (e && e.key === "Escape") {
        drag = null;
        const { box } = getOverlayElements();
        if (box) box.style.display = "none";
      }
    };
    try { window.addEventListener("keydown", keyHandler, { passive: true }); } catch (_) { window.addEventListener("keydown", keyHandler); }
    cancelListener = eventBus.on && eventBus.on("tools:cancel", () => {
      drag = null;
      const { box } = getOverlayElements();
      if (box) box.style.display = "none";
    });

    viewportListenerCleanup.push(eventBus.on("viewport:pan", () => renderOverlay()));
    viewportListenerCleanup.push(eventBus.on("viewport:zoom", () => renderOverlay()));
    viewportListenerCleanup.push(eventBus.on("viewport:reset", () => renderOverlay()));

    renderOverlay();
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
    if (keyHandler) { try { window.removeEventListener("keydown", keyHandler); } catch (_) {} }
    keyHandler = null;
    try { if (typeof cancelListener === "function") cancelListener(); } catch (_) {}
    cancelListener = null;
    viewportListenerCleanup.forEach((off) => { try { if (typeof off === "function") off(); } catch (_) {} });
    viewportListenerCleanup = [];
    // Keep overlay visible if selection exists
    renderOverlay();
  }

  function updatePreview(x2, y2, event) {
    const rect = buildRectFromDrag(drag.startX, drag.startY, x2, y2);
    const { box } = getOverlayElements();
    if (!box) return;
    const p1 = worldToScreen(rect.x, rect.y);
    const p2 = worldToScreen(rect.x + rect.width, rect.y + rect.height);
    const left = Math.min(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const width = Math.abs(p2.x - p1.x);
    const height = Math.abs(p2.y - p1.y);
    box.style.display = "block";
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    box.style.width = `${Math.round(width)}px`;
    box.style.height = `${Math.round(height)}px`;
  }

  function buildRectFromDrag(x1, y1, x2, y2) {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    return { x, y, width: w, height: h };
  }

  function resolveModifierMode(e) {
    if (e && (e.ctrlKey || e.metaKey)) return "intersect";
    if (e && e.altKey) return "subtract";
    if (e && e.shiftKey) return "add";
    return store.getState().tools?.options?.select?.selectionMode || "replace";
  }

  function applyRect(rect, mode = "replace") {
    const clamped = clampRectToViewport(normaliseRect(rect));
    return history.execute(SELECT_SET_COMMAND, { rect: clamped, mode }, { meta: { tool: "select", mode } });
  }

  function deselect() {
    return history.execute(SELECT_CLEAR_COMMAND, {}, { meta: { tool: "select" } });
  }

  function clearSelectedPixels() {
    const state = store.getState();
    const layerId = state.layers?.active || null;
    if (!layerId) return null;
    return history.execute(SELECT_CLEAR_PIXELS_COMMAND, { layerId }, { meta: { tool: "select", layerId } });
  }

  function fillSelectedPixels(options = {}) {
    const state = store.getState();
    const layerId = state.layers?.active || null;
    if (!layerId) return null;
    const fillColor = typeof options.fillColor === "string" && options.fillColor.trim() !== "" ? options.fillColor.trim() : (store.getState().tools?.options?.fill?.fillColor || store.getState().ui?.color?.hex || "#000000");
    const opacity = typeof options.opacity === "number" ? Math.max(0, Math.min(1, options.opacity)) : (store.getState().tools?.options?.fill?.opacity ?? 1);
    return history.execute(SELECT_FILL_PIXELS_COMMAND, { layerId, fillColor, opacity }, { meta: { tool: "select", layerId } });
  }

  // Keep overlay in sync with selection changes even when tool inactive
  const unsubscribeSelection = store.subscribe(() => renderOverlay(), {
    selector: (s) => s.selection?.region,
    equality: Object.is,
    fireImmediately: true,
  });

  function destroy() {
    try { if (typeof unsubscribeSelection === "function") unsubscribeSelection(); } catch (_) {}
    detachPointer();
    const { overlay } = getOverlayElements();
    if (overlay) overlay.style.display = "none";
  }

  return {
    id: "select",
    label: "Select",
    cursor: "crosshair",
    getDefaultOptions() { return { ...DEFAULT_SELECT_OPTIONS }; },
    normalizeOptions(next = {}) { return { ...DEFAULT_SELECT_OPTIONS, ...(next || {}) }; },
    onActivate() { active = true; attachPointer(); if (eventBus) eventBus.emit("tools:select:activated", {}); },
    onDeactivate() { active = false; detachPointer(); if (eventBus) eventBus.emit("tools:select:deactivated", {}); },
    getPublicApi() {
      return {
        id: "select",
        applyRect,
        deselect,
        clear: clearSelectedPixels,
        fill: fillSelectedPixels,
        get options() { const options = store.getState().tools?.options?.select || {}; return { ...options }; },
        get region() { const r = store.getState().selection?.region || null; return r ? { ...r } : null; },
      };
    },
    applyRect,
    deselect,
    clear: clearSelectedPixels,
    fill: fillSelectedPixels,
    destroy,
  };
}
