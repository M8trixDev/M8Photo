import { store } from "../core/store.js";
import { eventBus } from "../core/events.js";
import { layerManager as sharedLayerManager, createLayerManager } from "./layerManager.js";
import { getCanvas as getAssetCanvas } from "../io/assetStore.js";

const DEFAULT_THUMBNAIL_WIDTH = 128;
const DEFAULT_THUMBNAIL_HEIGHT = 96;
const DEFAULT_PADDING = 6;

export function createThumbnailManager(options = {}) {
  const storeRef = options.store ?? store;
  const bus = options.eventBus ?? eventBus;
  const manager = options.layerManager ?? sharedLayerManager ?? createLayerManager({ store: storeRef, eventBus: bus });

  const cache = new Map();
  const subscriptions = [];

  if (bus) {
    subscriptions.push(
      bus.on("layers:update", (event) => {
        const layerId = event?.detail?.layerId;
        if (layerId) {
          invalidate(layerId);
        }
      })
    );

    subscriptions.push(
      bus.on("layers:create", (event) => {
        const layerId = event?.detail?.layerId;
        if (layerId) {
          invalidate(layerId);
        }
      })
    );

    subscriptions.push(
      bus.on("layers:visibility", (event) => {
        const layerId = event?.detail?.layerId;
        if (layerId) {
          invalidate(layerId);
        }
      })
    );

    subscriptions.push(
      bus.on("layers:lock", (event) => {
        const layerId = event?.detail?.layerId;
        if (layerId) {
          invalidate(layerId);
        }
      })
    );

    subscriptions.push(
      bus.on("layers:remove", (event) => {
        const layerId = event?.detail?.layerId;
        if (layerId) {
          remove(layerId);
        }
      })
    );
  }

  function normaliseSize(value, fallback) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return fallback;
    }
    return Math.max(1, Math.floor(value));
  }

  function normaliseLayerId(value) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (value && typeof value.id === "string") {
      return value.id.trim();
    }
    return null;
  }

  function getThumbnail(layerId, options = {}) {
    if (typeof document === "undefined") {
      return null;
    }

    const targetId = normaliseLayerId(layerId);
    if (!targetId) {
      return null;
    }

    const layer = manager.getLayer(targetId);
    if (!layer) {
      return null;
    }

    const width = normaliseSize(options.width, DEFAULT_THUMBNAIL_WIDTH);
    const height = normaliseSize(options.height, DEFAULT_THUMBNAIL_HEIGHT);
    const devicePixelRatio = typeof options.devicePixelRatio === "number" && !Number.isNaN(options.devicePixelRatio)
      ? Math.max(1, options.devicePixelRatio)
      : typeof window !== "undefined" && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1;

    const cacheKey = `${layer.id}:${width}x${height}@${devicePixelRatio}`;
    let entry = cache.get(cacheKey);

    if (!entry) {
      const canvas = document.createElement("canvas");
      entry = {
        layerId: layer.id,
        canvas,
        width,
        height,
        dpr: devicePixelRatio,
        version: null,
        dirty: true,
      };
      cache.set(cacheKey, entry);
    }

    if (entry.layerId !== layer.id) {
      entry.layerId = layer.id;
      entry.version = null;
      entry.dirty = true;
    }

    const version = layer.updatedAt ?? layer.createdAt ?? 0;

    if (entry.version !== version || entry.dirty) {
      renderThumbnail(entry.canvas, layer, {
        width: entry.width,
        height: entry.height,
        dpr: entry.dpr,
      });
      entry.version = version;
      entry.dirty = false;
    }

    return entry.canvas;
  }

  function invalidate(layerId) {
    const targetId = normaliseLayerId(layerId);

    cache.forEach((entry) => {
      if (!targetId || entry.layerId === targetId) {
        entry.dirty = true;
      }
    });
  }

  function invalidateMany(layerIds) {
    if (!Array.isArray(layerIds) || !layerIds.length) {
      invalidate(null);
      return;
    }

    const targets = new Set(layerIds.map((id) => normaliseLayerId(id)).filter(Boolean));
    cache.forEach((entry) => {
      if (targets.has(entry.layerId)) {
        entry.dirty = true;
      }
    });
  }

  function remove(layerId) {
    const targetId = normaliseLayerId(layerId);
    if (!targetId) {
      return;
    }

    Array.from(cache.entries()).forEach(([key, entry]) => {
      if (entry.layerId === targetId) {
        cache.delete(key);
      }
    });
  }

  function removeMany(layerIds) {
    if (!Array.isArray(layerIds) || !layerIds.length) {
      return;
    }

    const targets = new Set(layerIds.map((id) => normaliseLayerId(id)).filter(Boolean));
    Array.from(cache.entries()).forEach(([key, entry]) => {
      if (targets.has(entry.layerId)) {
        cache.delete(key);
      }
    });
  }

  function clear() {
    cache.clear();
  }

  function dispose() {
    clear();
    while (subscriptions.length) {
      const unsubscribe = subscriptions.pop();
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    }
  }

  return {
    getThumbnail,
    invalidate,
    invalidateMany,
    remove,
    removeMany,
    clear,
    dispose,
  };
}

function renderThumbnail(canvas, layer, metrics) {
  if (!canvas) {
    return null;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const dpr = metrics.dpr || 1;
  const pixelWidth = Math.max(1, Math.floor(metrics.width * dpr));
  const pixelHeight = Math.max(1, Math.floor(metrics.height * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  canvas.style.width = `${metrics.width}px`;
  canvas.style.height = `${metrics.height}px`;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();

  context.save();
  context.scale(dpr, dpr);

  drawThumbnailBackground(context, metrics.width, metrics.height);
  drawLayerPreview(context, layer, metrics.width, metrics.height);
  drawThumbnailFrame(context, metrics.width, metrics.height);

  context.restore();

  return canvas;
}

function drawThumbnailBackground(context, width, height) {
  context.save();
  context.fillStyle = "rgba(18, 22, 32, 0.92)";
  context.fillRect(0, 0, width, height);

  const square = 6;
  context.fillStyle = "rgba(255, 255, 255, 0.06)";
  for (let y = 0; y < height; y += square) {
    for (let x = (Math.floor(y / square) % 2) * square; x < width; x += square * 2) {
      context.fillRect(x, y, square, square);
    }
  }

  context.restore();
}

function drawLayerPreview(context, layer, width, height) {
  const contentWidth = Math.max(1, layer.dimensions?.width ?? 1);
  const contentHeight = Math.max(1, layer.dimensions?.height ?? 1);
  const padding = Math.min(DEFAULT_PADDING, Math.min(width, height) / 6);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);

  const drawWidth = contentWidth * scale;
  const drawHeight = contentHeight * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;

  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);

  const baseOpacity = typeof layer.opacity === "number" ? layer.opacity : 1;
  if (layer.visible === false || baseOpacity <= 0) {
    context.globalAlpha = 0.25;
  } else {
    context.globalAlpha = baseOpacity;
  }

  paintLayerContent(context, layer);

  context.restore();
}

function drawThumbnailFrame(context, width, height) {
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.restore();
}

function paintLayerContent(context, layer) {
  const width = Math.max(1, layer.dimensions?.width ?? 0);
  const height = Math.max(1, layer.dimensions?.height ?? 0);

  if (width <= 0 || height <= 0) {
    return;
  }

  const assetId = layer?.metadata?.imageAssetId;
  const imageCanvas = assetId ? getAssetCanvas(assetId) : null;
  if (imageCanvas) {
    try {
      context.drawImage(imageCanvas, 0, 0, width, height);
    } catch (e) {
      const gradient = createLayerGradient(context, layer, width, height);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
  } else {
    const gradient = createLayerGradient(context, layer, width, height);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  if (layer.type === "effect") {
    context.save();
    context.globalAlpha = 0.2;
    context.fillStyle = "rgba(255, 255, 255, 0.35)";
    const spacing = Math.max(12, Math.min(width, height) / 4);
    for (let position = -height; position < width + height; position += spacing) {
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position + height, height);
      context.lineTo(position + height + spacing * 0.5, height);
      context.lineTo(position + spacing * 0.5, 0);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  if (Array.isArray(layer.strokes) && layer.strokes.length > 0) {
    context.save();
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = Math.max(1, Math.min(width, height) / 32);
    context.strokeStyle = `hsla(${(hashStringToHue(layer.id) + 180) % 360}, 72%, 60%, 0.75)`;
    context.globalAlpha = 0.85;

    layer.strokes.forEach((stroke) => {
      const points = Array.isArray(stroke?.points) ? stroke.points : [];
      if (points.length < 2) {
        return;
      }
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    });

    context.restore();
  }
}

function createLayerGradient(context, layer, width, height) {
  const hue = (hashStringToHue(layer.id || layer.name) + (layer.stackIndex || 0) * 11) % 360;
  const gradient = context.createLinearGradient(0, 0, width, height);

  if (layer.type === "adjustment") {
    gradient.addColorStop(0, `hsla(${hue}, 88%, 68%, 0.55)`);
    gradient.addColorStop(0.5, `hsla(${(hue + 48) % 360}, 82%, 50%, 0.35)`);
    gradient.addColorStop(1, `hsla(${(hue + 120) % 360}, 74%, 42%, 0.3)`);
  } else if (layer.type === "effect") {
    gradient.addColorStop(0, `hsla(${(hue + 220) % 360}, 58%, 62%, 0.5)`);
    gradient.addColorStop(1, `hsla(${(hue + 184) % 360}, 72%, 36%, 0.45)`);
  } else {
    gradient.addColorStop(0, `hsla(${hue}, 72%, 68%, 0.92)`);
    gradient.addColorStop(1, `hsla(${(hue + 24) % 360}, 66%, 42%, 0.9)`);
  }

  return gradient;
}

function hashStringToHue(input) {
  const value = String(input ?? "layer");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

export const layerThumbnails = createThumbnailManager();
