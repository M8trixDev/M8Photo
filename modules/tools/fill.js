import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { layerManager } from "../layers/layerManager.js";
import { getCanvas as getAssetCanvas, registerCanvas as registerAssetCanvas } from "../io/assetStore.js";

const FILL_APPLY_COMMAND = "tool:fill:apply";

const DEFAULT_FILL_OPTIONS = Object.freeze({
  tolerance: 32, // 0..255
  contiguous: true,
  respectAlpha: true,
  fillColor: "#000000",
  opacity: 1,
});

function normaliseFillOptions(options = {}) {
  const next = { ...DEFAULT_FILL_OPTIONS, ...(options || {}) };
  let tol = Number(next.tolerance);
  if (!Number.isFinite(tol)) tol = DEFAULT_FILL_OPTIONS.tolerance;
  next.tolerance = Math.max(0, Math.min(255, tol));
  next.contiguous = next.contiguous !== false;
  next.respectAlpha = next.respectAlpha !== false;
  next.fillColor = typeof next.fillColor === "string" && next.fillColor.trim() !== "" ? next.fillColor.trim() : DEFAULT_FILL_OPTIONS.fillColor;
  const op = Number(next.opacity);
  next.opacity = Number.isFinite(op) ? Math.max(0, Math.min(1, op)) : 1;
  return next;
}

function parseColorToRgba(color, opacity = 1) {
  // Supports #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), or named colors via canvas
  const ctx = parseColorToRgba._ctx || (parseColorToRgba._ctx = document.createElement("canvas").getContext("2d"));
  if (!ctx) return { r: 0, g: 0, b: 0, a: Math.round(opacity * 255) };
  try {
    ctx.fillStyle = color;
  } catch (_) {
    ctx.fillStyle = "#000";
  }
  const computed = ctx.fillStyle; // normalised rgb(a)
  // Create a dummy element to leverage getComputedStyle
  const div = document.createElement("div");
  div.style.color = computed;
  document.body.appendChild(div);
  const cs = getComputedStyle(div).color;
  document.body.removeChild(div);
  const m = cs.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(/\s*,\s*/).map(Number);
    const r = Math.max(0, Math.min(255, Math.round(parts[0] || 0)));
    const g = Math.max(0, Math.min(255, Math.round(parts[1] || 0)));
    const b = Math.max(0, Math.min(255, Math.round(parts[2] || 0)));
    let a = parts.length > 3 ? parts[3] : 1;
    if (!Number.isFinite(a)) a = 1;
    a = Math.max(0, Math.min(1, a)) * opacity;
    return { r, g, b, a: Math.round(a * 255) };
  }
  // Fallback: assume hex
  return { r: 0, g: 0, b: 0, a: Math.round(opacity * 255) };
}

function colorDistance(c1, c2, respectAlpha) {
  // Use max absolute channel delta, including alpha if respectAlpha
  const dr = Math.abs(c1.r - c2.r);
  const dg = Math.abs(c1.g - c2.g);
  const db = Math.abs(c1.b - c2.b);
  if (respectAlpha) {
    const da = Math.abs((c1.a ?? 255) - (c2.a ?? 255));
    return Math.max(dr, dg, db, da);
  }
  return Math.max(dr, dg, db);
}

function getPixelColor(data, idx) {
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
}

function setPixelColor(data, idx, color) {
  data[idx] = color.r;
  data[idx + 1] = color.g;
  data[idx + 2] = color.b;
  data[idx + 3] = color.a;
}

function worldToLayerLocal(worldX, worldY, layer) {
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

  // Un-scale
  if (scaleX !== 0) x /= scaleX;
  if (scaleY !== 0) y /= scaleY;

  if (Math.abs(rotation) > 1e-6) {
    // Undo rotation around layer center
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
    layerManager.updateLayer(layer.id, { metadata: { ...meta, imageAssetId: id } }, { source: "fill-tool" });
  } else {
    // Ensure correct size
    if (canvas.width !== width || canvas.height !== height) {
      const tmp = document.createElement("canvas");
      tmp.width = width;
      tmp.height = height;
      const tctx = tmp.getContext("2d");
      try { tctx.drawImage(canvas, 0, 0, width, height); } catch (_) {}
      const id = registerAssetCanvas(tmp, { prefix: "image", ownerId: layer.id, mimeType: "image/png" });
      layerManager.updateLayer(layer.id, { metadata: { ...meta, imageAssetId: id } }, { source: "fill-tool" });
      canvas = tmp;
    }
  }
  return canvas;
}

function registerFillCommand() {
  if (history.hasCommand(FILL_APPLY_COMMAND)) return;
  history.registerCommand(FILL_APPLY_COMMAND, ({ payload }) => {
    const layerId = payload?.layerId;
    const seed = payload?.seed || { x: 0, y: 0 };
    const optionsSnapshot = normaliseFillOptions(payload?.optionsSnapshot || {});

    let beforeImageData = null;
    let changed = false;
    let appliedCount = 0;

    return {
      type: FILL_APPLY_COMMAND,
      label: "Fill",
      meta: { tool: "fill", layerId },
      layerId,
      optionsSnapshot,
      seed,
      execute() {
         const state = store.getState();
         const layer = state.layers?.entities?.[layerId];
         if (!layer || layer.locked) return null;
         const canvas = ensureLayerAssetCanvas(layer);
         const ctx = canvas.getContext("2d");
         const dims = layer.dimensions || {};
         const width = dims.width || canvas.width;
         const height = dims.height || canvas.height;
         const img = ctx.getImageData(0, 0, width, height);
         beforeImageData = img.data.slice();
         // Selection mask (if any)
         let mask = null;
         const region = state.selection?.region || null;
         if (region && region.width > 0 && region.height > 0) {
           const p1 = worldToLayerLocal(region.x, region.y, layer);
           const p2 = worldToLayerLocal(region.x + region.width, region.y + region.height, layer);
           const left = Math.max(0, Math.floor(Math.min(p1.x, p2.x)));
           const top = Math.max(0, Math.floor(Math.min(p1.y, p2.y)));
           const right = Math.min(width, Math.ceil(Math.max(p1.x, p2.x)));
           const bottom = Math.min(height, Math.ceil(Math.max(p1.y, p2.y)));
           if (right > left && bottom > top) {
             mask = { left, top, right, bottom };
           }
         }
         const result = applyFloodFill(img, seed.x, seed.y, optionsSnapshot, mask);
         appliedCount = result.filled || 0;
         if (result.changed) {
           ctx.putImageData(img, 0, 0);
           changed = true;
           if (eventBus) eventBus.emit("tools:fill:applied", { layerId, seed, filled: appliedCount });
         }
         return appliedCount;
       },
      undo() {
        if (!changed) return null;
        const state = store.getState();
        const layer = state.layers?.entities?.[layerId];
        if (!layer) return null;
        const meta = layer.metadata || {};
        const canvas = getAssetCanvas(meta.imageAssetId);
        if (!canvas) return null;
        const ctx = canvas.getContext("2d");
        const dims = layer.dimensions || {};
        const width = dims.width || canvas.width;
        const height = dims.height || canvas.height;
        const img = ctx.getImageData(0, 0, width, height);
        if (beforeImageData && beforeImageData.length === img.data.length) {
          img.data.set(beforeImageData);
          ctx.putImageData(img, 0, 0);
        }
        if (eventBus) eventBus.emit("tools:fill:undo", { layerId, seed });
        return true;
      },
      redo() {
        // Re-apply by executing again
        this.execute();
        if (eventBus) eventBus.emit("tools:fill:applied", { layerId, seed, redo: true, filled: appliedCount });
        return appliedCount;
      },
    };
  });
}

function applyFloodFill(imageData, x, y, options, maskRect) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return { changed: false, filled: 0 };

  // Respect selection mask if provided
  if (maskRect) {
    const { left, top, right, bottom } = maskRect;
    if (xi < left || xi >= right || yi < top || yi >= bottom) {
      return { changed: false, filled: 0 };
    }
  }

  const idx = (yi * width + xi) * 4;
  const target = getPixelColor(data, idx);
  const fill = parseColorToRgba(options.fillColor, options.opacity);

  // If target already equals fill (within tolerance 0), skip
  if (colorDistance(target, fill, options.respectAlpha) === 0) {
    return { changed: false, filled: 0 };
  }

  let filled = 0;

  if (options.contiguous) {
    const visited = new Uint8Array(width * height);
    const stack = [[xi, yi]];
    const tol = Math.max(0, Math.min(255, options.tolerance));

    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      if (maskRect) {
        if (cx < maskRect.left || cx >= maskRect.right || cy < maskRect.top || cy >= maskRect.bottom) continue;
      }
      const cIndex = cy * width + cx;
      if (visited[cIndex]) continue;
      visited[cIndex] = 1;
      const di = cIndex * 4;
      const cur = getPixelColor(data, di);
      if (colorDistance(cur, target, options.respectAlpha) <= tol) {
        setPixelColor(data, di, fill);
        filled += 1;
        stack.push([cx + 1, cy]);
        stack.push([cx - 1, cy]);
        stack.push([cx, cy + 1]);
        stack.push([cx, cy - 1]);
      }
    }
    return { changed: filled > 0, filled };
  }

  // Non-contiguous: fill all matching pixels
  const tol = Math.max(0, Math.min(255, options.tolerance));
  const yStart = maskRect ? Math.max(0, Math.floor(maskRect.top)) : 0;
  const yEnd = maskRect ? Math.min(height, Math.ceil(maskRect.bottom)) : height;
  const xStartDef = maskRect ? Math.max(0, Math.floor(maskRect.left)) : 0;
  const xEndDef = maskRect ? Math.min(width, Math.ceil(maskRect.right)) : width;
  for (let py = yStart; py < yEnd; py += 1) {
    let offset = (py * width + (xStartDef)) * 4;
    for (let px = xStartDef; px < xEndDef; px += 1) {
      const cur = { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
      if (colorDistance(cur, target, options.respectAlpha) <= tol) {
        setPixelColor(data, offset, fill);
        filled += 1;
      }
      offset += 4;
    }
  }
  return { changed: filled > 0, filled };
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

export function createFillTool(context = {}) {
  registerFillCommand();

  let pointerDownHandler = null;

  function attachPointer() {
    const canvas = document.getElementById("workspace-canvas");
    if (!canvas) return;
    pointerDownHandler = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const world = computeWorkspacePointFromEvent(e);
      const state = store.getState();
      const activeId = state.layers?.active;
      if (!activeId) return;
      const layer = state.layers?.entities?.[activeId];
      if (!layer || layer.locked) return;
      const local = worldToLayerLocal(world.x, world.y, layer);
      const opts = normaliseFillOptions(store.getState().tools?.options?.fill || {});
      const payload = {
        layerId: activeId,
        seed: { x: Math.round(local.x), y: Math.round(local.y) },
        optionsSnapshot: opts,
      };
      history.execute(FILL_APPLY_COMMAND, payload, { meta: { tool: "fill", layerId: activeId } });
    };
    canvas.addEventListener("pointerdown", pointerDownHandler, { capture: true });
  }

  function detachPointer() {
    const canvas = document.getElementById("workspace-canvas");
    if (canvas && pointerDownHandler) {
      try { canvas.removeEventListener("pointerdown", pointerDownHandler, { capture: true }); } catch (_) { canvas.removeEventListener("pointerdown", pointerDownHandler); }
    }
    pointerDownHandler = null;
  }

  return {
    id: "fill",
    label: "Fill",
    cursor: "cell",
    getDefaultOptions() { return { ...DEFAULT_FILL_OPTIONS }; },
    normalizeOptions(next = {}) { return normaliseFillOptions(next); },
    onActivate(meta) { attachPointer(); if (eventBus) eventBus.emit("tools:fill:activated", { source: meta?.source || "user" }); },
    onDeactivate(meta) { detachPointer(); if (eventBus) eventBus.emit("tools:fill:deactivated", { source: meta?.source || "user" }); },
    onOptionsChanged() {},
    getPublicApi() {
      return {
        id: "fill",
        applyAt(worldX, worldY) {
          const state = store.getState();
          const activeId = state.layers?.active;
          if (!activeId) return null;
          const layer = state.layers?.entities?.[activeId];
          if (!layer || layer.locked) return null;
          const local = worldToLayerLocal(worldX, worldY, layer);
          const opts = normaliseFillOptions(store.getState().tools?.options?.fill || {});
          return history.execute(FILL_APPLY_COMMAND, { layerId: activeId, seed: { x: Math.round(local.x), y: Math.round(local.y) }, optionsSnapshot: opts }, { meta: { tool: "fill", layerId: activeId } });
        },
        get options() {
          const options = store.getState().tools?.options?.fill || {};
          return { ...options };
        },
      };
    },
  };
}
