import { store } from "../core/store.js";
import { eventBus } from "../core/events.js";
import * as assetStore from "../io/assetStore.js";

/**
 * Mask Manager: Handles layer masks and clipping masks
 */

function createMaskCanvas(width, height, fill = 255) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = `rgba(${fill}, ${fill}, ${fill}, 1)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export function createMaskForLayer(layerId, options = {}) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  if (!layer) {
    console.warn("Cannot create mask: layer not found", layerId);
    return null;
  }

  const width = layer.dimensions?.width || 512;
  const height = layer.dimensions?.height || 512;
  const fill = typeof options.fill === "number" ? options.fill : 255; // Default to fully visible

  const maskCanvas = createMaskCanvas(width, height, fill);
  const maskAssetId = assetStore.registerCanvas(maskCanvas, { prefix: "mask" });

  return {
    type: "layer",
    assetId: maskAssetId,
    enabled: options.enabled !== false,
    inverted: Boolean(options.inverted),
  };
}

export function updateLayerMask(layerId, maskData) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  if (!layer) {
    return false;
  }

  store.updateSlice(
    "layers",
    (layers) => {
      const entities = { ...layers.entities };
      const entity = { ...entities[layerId] };
      const metadata = { ...entity.metadata };

      metadata.mask = maskData ? { ...maskData } : null;
      entity.metadata = metadata;
      entity.updatedAt = Date.now();
      entities[layerId] = entity;

      return { ...layers, entities };
    },
    { reason: "mask:update", layerId }
  );

  if (eventBus) {
    eventBus.emit("mask:updated", { layerId, mask: maskData });
  }

  return true;
}

export function getLayerMask(layerId) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  return layer?.metadata?.mask || null;
}

export function toggleLayerMask(layerId) {
  const mask = getLayerMask(layerId);
  if (!mask) {
    return false;
  }

  const updated = { ...mask, enabled: !mask.enabled };
  return updateLayerMask(layerId, updated);
}

export function setClippingMask(layerId, clippedToLayerId) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  const targetLayer = clippedToLayerId ? state.layers?.entities?.[clippedToLayerId] : null;

  if (!layer) {
    return false;
  }

  if (clippedToLayerId && !targetLayer) {
    console.warn("Cannot create clipping mask: target layer not found", clippedToLayerId);
    return false;
  }

  store.updateSlice(
    "layers",
    (layers) => {
      const entities = { ...layers.entities };
      const entity = { ...entities[layerId] };
      const metadata = { ...entity.metadata };

      metadata.clippingMask = clippedToLayerId || null;
      entity.metadata = metadata;
      entity.updatedAt = Date.now();
      entities[layerId] = entity;

      return { ...layers, entities };
    },
    { reason: "clipping-mask:set", layerId, clippedTo: clippedToLayerId }
  );

  if (eventBus) {
    eventBus.emit("clipping-mask:set", { layerId, clippedTo: clippedToLayerId });
  }

  return true;
}

export function getClippingMask(layerId) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  return layer?.metadata?.clippingMask || null;
}

export function applyMaskToCanvas(sourceCanvas, maskCanvas, inverted = false) {
  if (!sourceCanvas || !maskCanvas) {
    return sourceCanvas;
  }

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = width;
  resultCanvas.height = height;
  const ctx = resultCanvas.getContext("2d");

  if (!ctx) {
    return sourceCanvas;
  }

  // Draw source
  ctx.drawImage(sourceCanvas, 0, 0);

  // Get mask data
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) {
    return sourceCanvas;
  }

  const sourceData = ctx.getImageData(0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

  // Apply mask to alpha channel
  for (let i = 0; i < sourceData.data.length; i += 4) {
    const pixelIndex = i / 4;
    const maskX = Math.floor(pixelIndex % width);
    const maskY = Math.floor(pixelIndex / width);

    if (maskX < maskCanvas.width && maskY < maskCanvas.height) {
      const maskIndex = (maskY * maskCanvas.width + maskX) * 4;
      // Use red channel of mask as alpha multiplier (grayscale mask)
      let maskValue = maskData.data[maskIndex] / 255;

      if (inverted) {
        maskValue = 1 - maskValue;
      }

      sourceData.data[i + 3] *= maskValue;
    } else {
      // Outside mask bounds
      sourceData.data[i + 3] = 0;
    }
  }

  ctx.putImageData(sourceData, 0, 0);
  return resultCanvas;
}

export function brushMaskStroke(layerId, points, brushOptions = {}) {
  const mask = getLayerMask(layerId);
  if (!mask || !mask.assetId) {
    return false;
  }

  const maskCanvas = assetStore.getCanvas(mask.assetId);
  if (!maskCanvas) {
    return false;
  }

  const ctx = maskCanvas.getContext("2d");
  if (!ctx || !Array.isArray(points) || points.length === 0) {
    return false;
  }

  const size = typeof brushOptions.size === "number" ? brushOptions.size : 32;
  const opacity = typeof brushOptions.opacity === "number" ? brushOptions.opacity : 1;
  const color = brushOptions.erase ? "rgba(0, 0, 0, " + opacity + ")" : "rgba(255, 255, 255, " + opacity + ")";

  ctx.save();
  ctx.globalCompositeOperation = brushOptions.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();

  // Also fill single points
  if (points.length === 1) {
    const p = points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Update the mask asset
  assetStore.updateCanvas(mask.assetId, maskCanvas);

  if (eventBus) {
    eventBus.emit("mask:edited", { layerId });
  }

  return true;
}

export function fillMask(layerId, value = 255) {
  const mask = getLayerMask(layerId);
  if (!mask || !mask.assetId) {
    return false;
  }

  const maskCanvas = assetStore.getCanvas(mask.assetId);
  if (!maskCanvas) {
    return false;
  }

  const ctx = maskCanvas.getContext("2d");
  if (!ctx) {
    return false;
  }

  ctx.fillStyle = `rgba(${value}, ${value}, ${value}, 1)`;
  ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

  assetStore.updateCanvas(mask.assetId, maskCanvas);

  if (eventBus) {
    eventBus.emit("mask:edited", { layerId });
  }

  return true;
}

export const maskManager = {
  createMaskForLayer,
  updateLayerMask,
  getLayerMask,
  toggleLayerMask,
  setClippingMask,
  getClippingMask,
  applyMaskToCanvas,
  brushMaskStroke,
  fillMask,
};
