import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { layerManager } from "../layers/layerManager.js";
import { clampZoom } from "../view/viewport.js";

const SHAPE_ADD_COMMAND = "tool:shape:add";

const DEFAULT_SHAPE_OPTIONS = Object.freeze({
  shape: "rectangle", // rectangle | ellipse | line
  strokeWidth: 3,
  strokeColor: "#ffffff",
  fillColor: "#000000",
  strokeEnabled: true,
  fillEnabled: true,
  cornerRadius: 0, // for rectangle only
});

function normaliseShapeOptions(options = {}) {
  const next = { ...DEFAULT_SHAPE_OPTIONS, ...(options || {}) };
  const t = String(next.shape || "rectangle").toLowerCase();
  next.shape = ["rectangle", "ellipse", "line"].includes(t) ? t : "rectangle";
  const w = Number(next.strokeWidth);
  next.strokeWidth = Number.isFinite(w) ? Math.max(0, Math.min(256, w)) : DEFAULT_SHAPE_OPTIONS.strokeWidth;
  next.strokeEnabled = next.strokeEnabled !== false;
  next.fillEnabled = next.fillEnabled !== false;
  next.strokeColor = typeof next.strokeColor === "string" && next.strokeColor.trim() !== "" ? next.strokeColor.trim() : DEFAULT_SHAPE_OPTIONS.strokeColor;
  next.fillColor = typeof next.fillColor === "string" && next.fillColor.trim() !== "" ? next.fillColor.trim() : DEFAULT_SHAPE_OPTIONS.fillColor;
  const cr = Number(next.cornerRadius);
  next.cornerRadius = Number.isFinite(cr) ? Math.max(0, Math.min(256, cr)) : 0;
  return next;
}

function worldToLayerLocal(worldX, worldY, layer) {
  const t = layer.transform || {};
  const d = layer.dimensions || {};
  const width = d.width || 0;
  const height = d.height || 0;
  const scaleX = typeof t.scaleX === "number" ? t.scaleX : 1;
  const scaleY = typeof t.scaleY === "number" ? t.scaleY : 1;
  const rotation = ((typeof t.rotation === "number" ? t.rotation : 0) * Math.PI) / 180;

  let x = worldX - (t.x || 0);
  let y = worldY - (t.y || 0);
  if (scaleX !== 0) x /= scaleX;
  if (scaleY !== 0) y /= scaleY;

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

  return { x, y };
}

function computeWorkspacePointFromEvent(event) {
  const canvas = document.getElementById("workspace-canvas");
  const stage = canvas?.closest("[data-viewport-stage]") || canvas?.parentElement;
  if (!canvas || !stage) return { x: 0, y: 0 };
  const viewport = store.getState().viewport || {};
  const zoom = clampZoom(viewport.zoom ?? 1, viewport.minZoom, viewport.maxZoom);
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

function ensureShapeOverlay() {
  const stage = document.querySelector("[data-viewport-stage]");
  if (!stage) return null;
  let overlay = stage.querySelector("[data-shape-overlay]");
  if (!overlay) {
    overlay = document.createElement("canvas");
    overlay.setAttribute("data-shape-overlay", "");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    overlay.width = stage.clientWidth;
    overlay.height = stage.clientHeight;
    stage.appendChild(overlay);
  }
  return overlay;
}

function clearOverlay(overlay) {
  if (!overlay) return;
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function resizeOverlayToStage(overlay) {
  const stage = document.querySelector("[data-viewport-stage]");
  if (!stage || !overlay) return;
  const w = Math.max(1, Math.round(stage.clientWidth));
  const h = Math.max(1, Math.round(stage.clientHeight));
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
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

function registerShapeAddCommand() {
  if (history.hasCommand(SHAPE_ADD_COMMAND)) return;
  history.registerCommand(SHAPE_ADD_COMMAND, ({ payload }) => {
    const layerId = payload?.layerId;
    const shape = payload?.shape || {};
    const optionsSnapshot = normaliseShapeOptions(payload?.optionsSnapshot || {});
    let addedIndex = -1;
    let createdId = null;
    return {
      type: SHAPE_ADD_COMMAND,
      label: "Add Shape",
      meta: { tool: "shape", layerId, shape: shape?.type || shape?.shape || optionsSnapshot.shape },
      execute({ store: sharedStore }) {
        const state = sharedStore.getState();
        const layer = state.layers?.entities?.[layerId];
        if (!layer || layer.locked) return null;
        const strokes = Array.isArray(layer.strokes) ? layer.strokes.slice() : [];
        const id = createdId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `shape-${Date.now()}`);
        const shapeRecord = {
          id,
          tool: "shape",
          type: shape?.type || shape?.shape || optionsSnapshot.shape,
          options: { ...optionsSnapshot },
          geometry: { ...(shape.geometry || {}) },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        strokes.push(shapeRecord);
        sharedStore.updateSlice(
          "layers",
          (layers) => ({
            ...layers,
            entities: { ...layers.entities, [layerId]: { ...layer, strokes, updatedAt: Date.now() } },
          }),
          { reason: "tools:shape-add", layerId }
        );
        addedIndex = strokes.length - 1;
        createdId = id;
        if (eventBus) eventBus.emit("tools:shape:added", { layerId, shape: shapeRecord });
        return shapeRecord.id;
      },
      undo({ store: sharedStore }) {
        if (addedIndex < 0 && !createdId) return null;
        const state = sharedStore.getState();
        const layer = state.layers?.entities?.[layerId];
        if (!layer) return null;
        const strokes = Array.isArray(layer.strokes) ? layer.strokes.slice() : [];
        const index = strokes.findIndex((s) => s && s.tool === "shape" && s.id === createdId);
        const targetIndex = index >= 0 ? index : addedIndex;
        if (targetIndex < 0 || targetIndex >= strokes.length) return null;
        const [removed] = strokes.splice(targetIndex, 1);
        sharedStore.updateSlice(
          "layers",
          (layers) => ({ ...layers, entities: { ...layers.entities, [layerId]: { ...layer, strokes, updatedAt: Date.now() } } }),
          { reason: "tools:shape-remove", layerId }
        );
        if (eventBus) eventBus.emit("tools:shape:removed", { layerId, shape: removed, undo: true });
        return removed?.id || null;
      },
      redo({ store: sharedStore }) {
        // Re-apply executes with preserved createdId
        return this.execute({ store: sharedStore });
      },
    };
  });
}

export function createShapeTool(context = {}) {
  registerShapeAddCommand();

  let overlay = null;
  let drawing = false;
  let startWorld = null; // {x,y}
  let currentWorld = null;
  let pointerDownHandler = null;
  let pointerMoveHandler = null;
  let pointerUpHandler = null;
  let viewportCleanup = [];

  function attachPointer() {
    const canvas = document.getElementById("workspace-canvas");
    if (!canvas) return;
    overlay = ensureShapeOverlay();
    resizeOverlayToStage(overlay);

    pointerDownHandler = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      startWorld = world;
      currentWorld = world;
      drawing = true;
      renderOverlay();
    };

    pointerMoveHandler = (e) => {
      if (!drawing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      currentWorld = computeWorkspacePointFromEvent(e);
      renderOverlay(e.shiftKey);
    };

    pointerUpHandler = (e) => {
      if (!drawing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      currentWorld = world;
      commitShape(e.shiftKey);
      drawing = false;
      clearOverlay(overlay);
    };

    canvas.addEventListener("pointerdown", pointerDownHandler, { capture: true });
    canvas.addEventListener("pointermove", pointerMoveHandler, { capture: true });
    canvas.addEventListener("pointerup", pointerUpHandler, { capture: true });

    const onPanZoom = () => { resizeOverlayToStage(overlay); renderOverlay(); };
    viewportCleanup.push(eventBus.on("viewport:pan", onPanZoom));
    viewportCleanup.push(eventBus.on("viewport:zoom", onPanZoom));
    viewportCleanup.push(eventBus.on("viewport:reset", onPanZoom));
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
    viewportCleanup.forEach((off) => { try { if (typeof off === "function") off(); } catch (_) {} });
    viewportCleanup = [];
    if (overlay) clearOverlay(overlay);
  }

  function renderOverlay(shiftKey = false) {
    if (!overlay || !drawing || !startWorld || !currentWorld) return;
    resizeOverlayToStage(overlay);
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const opts = normaliseShapeOptions(store.getState().tools?.options?.shape || {});

    const p1 = worldToScreen(startWorld.x, startWorld.y);
    let p2 = worldToScreen(currentWorld.x, currentWorld.y);

    if (opts.shape === "line" && shiftKey) {
      // constrain angle to 45 deg increments
      const dx = currentWorld.x - startWorld.x;
      const dy = currentWorld.y - startWorld.y;
      const angle = Math.atan2(dy, dx);
      const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      const snappedX = startWorld.x + Math.cos(snap) * len;
      const snappedY = startWorld.y + Math.sin(snap) * len;
      p2 = worldToScreen(snappedX, snappedY);
    }

    if (opts.shape !== "line" && shiftKey) {
      // constrain to square/circle
      const w = Math.abs(p2.x - p1.x);
      const h = Math.abs(p2.y - p1.y);
      const s = Math.min(w, h);
      p2 = { x: p1.x + Math.sign(p2.x - p1.x) * s, y: p1.y + Math.sign(p2.y - p1.y) * s };
    }

    ctx.save();
    ctx.lineWidth = Math.max(1, opts.strokeWidth);
    ctx.strokeStyle = opts.strokeColor;
    ctx.fillStyle = opts.fillColor;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (opts.shape === "rectangle") {
      const left = Math.min(p1.x, p2.x);
      const top = Math.min(p1.y, p2.y);
      const width = Math.abs(p2.x - p1.x);
      const height = Math.abs(p2.y - p1.y);
      const r = Math.max(0, Math.min(opts.cornerRadius, Math.min(width, height) / 2));
      if (r > 0) {
        roundedRect(ctx, left, top, width, height, r);
      } else {
        ctx.beginPath();
        ctx.rect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(width), Math.round(height));
      }
      if (opts.fillEnabled) ctx.fill();
      if (opts.strokeEnabled && opts.strokeWidth > 0) ctx.stroke();
    } else if (opts.shape === "ellipse") {
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const rx = Math.abs(p2.x - p1.x) / 2;
      const ry = Math.abs(p2.y - p1.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (opts.fillEnabled) ctx.fill();
      if (opts.strokeEnabled && opts.strokeWidth > 0) ctx.stroke();
    } else {
      // line
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      if (opts.strokeEnabled && opts.strokeWidth > 0) ctx.stroke();
    }

    ctx.restore();
  }

  function roundedRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
  }

  function commitShape(shiftKey = false) {
    const state = store.getState();
    const activeId = state.layers?.active;
    if (!activeId || !startWorld || !currentWorld) return null;
    const layer = state.layers?.entities?.[activeId];
    if (!layer || layer.locked) return null;
    const opts = normaliseShapeOptions(store.getState().tools?.options?.shape || {});

    // Compute geometry in layer-local coords
    const sLocal = worldToLayerLocal(startWorld.x, startWorld.y, layer);
    let eLocal = worldToLayerLocal(currentWorld.x, currentWorld.y, layer);

    if (opts.shape === "line" && shiftKey) {
      // constrain line angle in world then map again
      const dx = currentWorld.x - startWorld.x;
      const dy = currentWorld.y - startWorld.y;
      const angle = Math.atan2(dy, dx);
      const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      const snappedX = startWorld.x + Math.cos(snap) * len;
      const snappedY = startWorld.y + Math.sin(snap) * len;
      eLocal = worldToLayerLocal(snappedX, snappedY, layer);
    }

    let geometry;
    if (opts.shape === "line") {
      geometry = { x1: sLocal.x, y1: sLocal.y, x2: eLocal.x, y2: eLocal.y };
    } else {
      // rect/ellipse
      let x1 = sLocal.x; let y1 = sLocal.y; let x2 = eLocal.x; let y2 = eLocal.y;
      if (shiftKey) {
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        const s = Math.min(w, h);
        x2 = x1 + Math.sign(x2 - x1) * s;
        y2 = y1 + Math.sign(y2 - y1) * s;
      }
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      geometry = { x: left, y: top, width, height };
    }

    const shapeDefinition = { type: opts.shape, geometry };

    return history.execute(
      SHAPE_ADD_COMMAND,
      { layerId: activeId, shape: shapeDefinition, optionsSnapshot: opts },
      { meta: { tool: "shape", layerId: activeId } }
    );
  }

  return {
    id: "shape",
    label: "Shape",
    cursor: "crosshair",
    getDefaultOptions() { return { ...DEFAULT_SHAPE_OPTIONS }; },
    normalizeOptions(next = {}) { return normaliseShapeOptions(next); },
    onActivate(meta) { attachPointer(); if (eventBus) eventBus.emit("tools:shape:activated", { source: meta?.source || "user" }); },
    onDeactivate(meta) { detachPointer(); if (eventBus) eventBus.emit("tools:shape:deactivated", { source: meta?.source || "user" }); },
    onOptionsChanged() { /* no-op for now */ },
    getPublicApi() {
      return {
        id: "shape",
        get options() {
          const options = store.getState().tools?.options?.shape || {};
          return { ...options };
        },
      };
    },
  };
}
