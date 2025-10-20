import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { createLayerManager, layerManager as sharedLayerManager } from "../layers/layerManager.js";
import { resolveBlendMode } from "../layers/blendModes.js";
import { readEXIFOrientation, loadImageElementFromFile, applyOrientationToCanvas } from "./exif.js";
import * as assetStore from "./assetStore.js";

const manager = sharedLayerManager || createLayerManager({ store, eventBus });

function normaliseLayerOpacity(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normaliseTransform(transform = {}) {
  return {
    x: typeof transform.x === "number" ? transform.x : 0,
    y: typeof transform.y === "number" ? transform.y : 0,
    rotation: typeof transform.rotation === "number" ? transform.rotation : 0,
    scaleX: typeof transform.scaleX === "number" && !Number.isNaN(transform.scaleX) ? transform.scaleX : 1,
    scaleY: typeof transform.scaleY === "number" && !Number.isNaN(transform.scaleY) ? transform.scaleY : 1,
  };
}

function drawLayerPlaceholder(ctx, layer) {
  const width = Math.max(1, layer.dimensions?.width ?? 0);
  const height = Math.max(1, layer.dimensions?.height ?? 0);
  if (width <= 0 || height <= 0) return;

  const hue = (hashStringToHue(layer.id || layer.name) + (layer.stackIndex || 0) * 11) % 360;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsla(${hue}, 72%, 68%, 0.92)`);
  gradient.addColorStop(1, `hsla(${(hue + 24) % 360}, 66%, 42%, 0.9)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function hashStringToHue(input) {
  const value = String(input ?? "layer");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

function normaliseFileName(name, ext) {
  const base = typeof name === "string" && name.trim() !== "" ? name.trim() : "export";
  const safe = base.replace(/[^a-z0-9_\-\.]+/gi, "_");
  if (!ext) return safe;
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  if (safe.toLowerCase().endsWith(suffix.toLowerCase())) return safe;
  return `${safe}${suffix}`;
}

function isSupportedImageFile(file) {
  if (!file) return false;
  const type = typeof file.type === "string" ? file.type.toLowerCase() : "";
  if (type === "image/png" || type === "image/jpeg") return true;
  // Fallback on extension for some browsers
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
}

export async function importImageFile(file, options = {}) {
  if (!file || !isSupportedImageFile(file)) {
    throw new Error("Unsupported file type. Please select a PNG or JPEG image.");
  }

  const image = await loadImageElementFromFile(file);
  const orientation = file.type === "image/jpeg" ? await readEXIFOrientation(file) : 1;
  const orientedCanvas = applyOrientationToCanvas(image, orientation);

  const assetId = assetStore.registerCanvas(orientedCanvas, {
    mimeType: file.type || "image/png",
    name: file.name || null,
    meta: { orientation },
  });

  const width = orientedCanvas.width;
  const height = orientedCanvas.height;
  const layerName = (file.name || "Image").replace(/\.[^.]+$/, "");

  const mode = options.mode === "new-project" ? "new-project" : "new-layer";

  if (mode === "new-project") {
    // Replace the project with a new one containing a single layer
    if (!history.hasCommand("io:replace-project")) {
      history.registerCommand("io:replace-project", ({ payload }) => {
        const snapshotBefore = store.getSnapshot();
        const prevLayers = snapshotBefore.layers;
        const prevViewport = snapshotBefore.viewport;
        const prevProject = snapshotBefore.project;

        const nextLayerDef = {
          name: payload.layerName || "Layer",
          type: "raster",
          locked: false,
          visible: true,
          opacity: 1,
          blendingMode: "normal",
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          dimensions: { width: payload.width, height: payload.height },
          strokes: [],
          metadata: { imageAssetId: payload.assetId, sourceFile: payload.fileName || null },
        };

        return {
          label: `Import ${payload.fileName || "Image"}`,
          meta: { action: "import", mode: "new-project", fileName: payload.fileName || null },
          execute({ store: sharedStore }) {
            // Layers slice
            sharedStore.updateSlice(
              "layers",
              () => {
                const def = nextLayerDef;
                const layerId = def.id || `layer-${Date.now().toString(36)}`;
                const entities = { [layerId]: { ...def, id: layerId, createdAt: Date.now(), updatedAt: Date.now() } };
                const order = [layerId];
                const stats = { count: 1, visible: 1 };
                return { order, entities, stats, active: layerId };
              },
              { reason: "io:replace-project:layers" }
            );

            // Viewport size
            sharedStore.updateSlice(
              "viewport",
              (viewport) => ({
                ...viewport,
                size: { width: payload.width, height: payload.height },
                pan: { x: 0, y: 0 },
                zoom: 1,
              }),
              { reason: "io:replace-project:viewport" }
            );

            // Selection
            sharedStore.updateSlice(
              "selection",
              (selection) => ({ ...selection, items: Object.keys(store.getState().layers.entities), bounds: null, mode: "replace" }),
              { reason: "io:replace-project:selection" }
            );

            // Project meta
            sharedStore.updateSlice(
              "project",
              (project) => ({
                ...project,
                id: null,
                name: payload.fileName ? payload.fileName.replace(/\.[^.]+$/, "") : "Imported Project",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }),
              { reason: "io:replace-project:meta" }
            );

            if (eventBus) {
              eventBus.emit("io:import", { mode: "new-project", fileName: payload.fileName || null });
            }
          },
          undo({ store: sharedStore }) {
            // Restore previous state slices
            sharedStore.updateSlice("layers", () => ({ ...prevLayers }), { reason: "io:replace-project:undo:layers" });
            sharedStore.updateSlice("viewport", () => ({ ...prevViewport }), { reason: "io:replace-project:undo:viewport" });
            sharedStore.updateSlice("project", () => ({ ...prevProject }), { reason: "io:replace-project:undo:project" });
          },
        };
      });
    }

    await history.execute("io:replace-project", {
      assetId,
      width,
      height,
      fileName: file.name || null,
      layerName,
    }, { meta: { source: "io" } });

    return { mode, assetId, width, height };
  }

  // Default: new-layer
  if (!history.hasCommand("io:add-layer")) {
    history.registerCommand("io:add-layer", ({ payload }) => {
      let createdId = null;
      return {
        label: `Import ${payload.fileName || "Image"}`,
        meta: { action: "import", mode: "new-layer", fileName: payload.fileName || null },
        execute() {
          const layer = manager.createLayer(
            {
              name: payload.layerName || "Layer",
              type: "raster",
              dimensions: { width: payload.width, height: payload.height },
              transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
              metadata: { imageAssetId: payload.assetId, sourceFile: payload.fileName || null },
            },
            { source: "io", position: "top", setActive: true, updateSelection: true }
          );
          createdId = layer?.id || null;
        },
        undo() {
          if (createdId) {
            manager.removeLayer(createdId, { source: "io", updateSelection: true });
          }
        },
      };
    });
  }

  await history.execute("io:add-layer", {
    assetId,
    width,
    height,
    fileName: file.name || null,
    layerName,
  }, { meta: { source: "io" } });

  return { mode, assetId, width, height };
}

export function openImportDialog(options = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png, image/jpeg";
  input.multiple = false;
  input.style.display = "none";

  const mode = options.mode || null;

  return new Promise((resolve, reject) => {
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }

      try {
        let chosenMode = mode;
        if (!chosenMode) {
          const replace = window.confirm("Import image: Click OK to replace the current project, or Cancel to add as a new layer.");
          chosenMode = replace ? "new-project" : "new-layer";
        }
        const result = await importImageFile(file, { mode: chosenMode });
        resolve(result);
      } catch (error) {
        console.error("Import failed", error);
        window.alert(error?.message || "Import failed. Unsupported file.");
        reject(error);
      }
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

export function composeProjectToCanvas(options = {}) {
  const state = store.getState();
  const width = Math.max(1, state.viewport?.size?.width || 1);
  const height = Math.max(1, state.viewport?.size?.height || 1);
  const scale = typeof options.scale === "number" && !Number.isNaN(options.scale) ? Math.max(0.01, options.scale) : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.save();
  ctx.scale(scale, scale);

  const layers = manager.getRenderableLayers({ state, bottomFirst: true, excludeHidden: true });
  layers.forEach((layer) => {
    const opacity = normaliseLayerOpacity(layer.opacity);
    if (opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = resolveBlendMode(layer.blendingMode);

    const transform = normaliseTransform(layer.transform);
    const dims = layer.dimensions || {};
    const lw = dims.width || 0;
    const lh = dims.height || 0;

    ctx.translate(transform.x, transform.y);
    if (transform.rotation) {
      ctx.translate(lw / 2, lh / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.translate(-lw / 2, -lh / 2);
    }
    ctx.scale(transform.scaleX || 1, transform.scaleY || 1);

    const assetId = layer.metadata?.imageAssetId;
    const imageCanvas = assetId ? assetStore.getCanvas(assetId) : null;
    if (imageCanvas) {
      try {
        ctx.drawImage(imageCanvas, 0, 0, lw, lh);
      } catch (err) {
        drawLayerPlaceholder(ctx, layer);
      }
    } else {
      drawLayerPlaceholder(ctx, layer);
    }

    ctx.restore();
  });

  ctx.restore();
  return canvas;
}

export function exportProject(options = {}) {
  const format = (options.format || "png").toLowerCase() === "jpg" ? "jpg" : (options.format || "png").toLowerCase();
  const mimeType = format === "jpg" || format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = typeof options.quality === "number" && !Number.isNaN(options.quality)
    ? Math.min(Math.max(options.quality, 0.1), 1)
    : 0.92;
  const scale = typeof options.scale === "number" && !Number.isNaN(options.scale) ? Math.max(0.01, options.scale) : 1;

  const canvas = composeProjectToCanvas({ scale });

  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Export failed"));
          return;
        }
        if (eventBus) {
          eventBus.emit("io:export", { format, scale });
        }
        resolve({ blob, width: canvas.width, height: canvas.height, mimeType });
      }, mimeType, quality);
      return;
    }

    try {
      const dataUrl = canvas.toDataURL(mimeType, quality);
      const byteString = atob(dataUrl.split(",")[1]);
      const array = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i += 1) {
        array[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([array], { type: mimeType });
      if (eventBus) {
        eventBus.emit("io:export", { format, scale });
      }
      resolve({ blob, width: canvas.width, height: canvas.height, mimeType });
    } catch (error) {
      reject(error);
    }
  });
}

export async function downloadExport(options = {}) {
  const projectName = store.getState().project?.name || "Untitled";
  const format = (options.format || "png").toLowerCase();
  const defaultExt = format === "jpg" ? "jpg" : format === "jpeg" ? "jpg" : "png";
  const fileName = normaliseFileName(options.fileName || projectName, defaultExt);
  const result = await exportProject({ format, quality: options.quality, scale: options.scale });
  const url = URL.createObjectURL(result.blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1000);
  }
  return { fileName, ...result };
}

// .m8s project export/import (single JSON file with embedded DataURLs)
export async function exportProjectAsM8S() {
  const state = store.getSnapshot();
  const entities = state.layers?.entities || {};
  const assetMap = {};
  Object.keys(entities).forEach((id) => {
    const layer = entities[id];
    const assetId = layer?.metadata?.imageAssetId;
    if (!assetId) return;
    const canvas = assetStore.getCanvas(assetId);
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png", 0.92);
      assetMap[assetId] = { mime: "image/png", dataUrl };
    } catch (_) {}
  });
  const payload = { version: 1, project: state.project, viewport: state.viewport, layers: state.layers, selection: state.selection, assets: assetMap };
  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: "application/json" });
  return { blob, payload };
}

export async function downloadM8S(fileName) {
  const name = normaliseFileName(fileName || (store.getState().project?.name || "Untitled"), "m8s");
  const { blob } = await exportProjectAsM8S();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  } finally {
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(_){}} , 1000);
  }
}

export async function openImportM8SDialog(){
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.m8s,application/json'; input.multiple=false; input.style.display='none';
  return new Promise((resolve, reject)=>{
    input.addEventListener('change', async ()=>{
      const file = input.files && input.files[0]; input.remove(); if (!file) { reject(new Error('No file selected')); return; }
      try { const text = await file.text(); const data = JSON.parse(text); await importM8S(data); resolve({ ok: true }); } catch (e){ console.error(e); window.alert('Invalid project file'); reject(e); }
    }, { once: true });
    document.body.appendChild(input); input.click();
  });
}

export async function importM8S(data){
  if (!data || typeof data !== 'object') throw new Error('Invalid data');
  const assets = data.assets || {};
  const idMap = {};
  // Recreate assets
  const keys = Object.keys(assets);
  for (let i=0; i<keys.length; i+=1){
    const key = keys[i]; const rec = assets[key];
    try {
      const img = await new Promise((res, rej)=>{ const im = new Image(); im.onload=()=>res(im); im.onerror=()=>rej(new Error('image')); im.src = rec.dataUrl; });
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
      const newId = assetStore.registerCanvas(canvas, { prefix: 'm8s' });
      idMap[key] = newId;
    } catch (_) {}
  }
  // Replace layer asset ids
  const layers = JSON.parse(JSON.stringify(data.layers || {}));
  const entities = layers.entities || {};
  Object.keys(entities).forEach((id)=>{
    const meta = entities[id].metadata || {}; const old = meta.imageAssetId; if (old && idMap[old]) { entities[id].metadata.imageAssetId = idMap[old]; }
  });
  store.replace({
    ...store.getSnapshot(),
    project: data.project || store.getState().project,
    viewport: data.viewport || store.getState().viewport,
    layers,
    selection: data.selection || store.getState().selection,
  }, { reason: 'io:import-m8s' });
}

export async function openExportDialog() {
  const projectName = store.getState().project?.name || "Untitled";
  const baseSize = store.getState().viewport?.size || { width: 1280, height: 720 };

  const module = await import("../ui/dialogs/exportDialog.js");
  if (!module || typeof module.showExportDialog !== "function") {
    // Fallback to direct export
    return downloadExport({ format: "png", scale: 1, fileName: projectName });
  }

  return module.showExportDialog({
    defaultFileName: projectName,
    baseSize,
    onRequestPreview: ({ scale }) => composeProjectToCanvas({ scale }),
    onConfirm: ({ format, quality, scale, fileName }) => downloadExport({ format, quality, scale, fileName }),
  });
}
