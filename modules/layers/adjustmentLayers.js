import { store } from "../core/store.js";
import { eventBus } from "../core/events.js";

/**
 * Adjustment Layers: Non-destructive color/tone adjustments
 */

export const ADJUSTMENT_TYPES = {
  BRIGHTNESS_CONTRAST: "brightnessContrast",
  SATURATION_HUE: "saturationHue",
};

export function createAdjustmentLayer(type, params = {}, options = {}) {
  const adjustmentData = {
    type,
    params: { ...params },
    enabled: options.enabled !== false,
  };

  return {
    type: "adjustment",
    metadata: {
      adjustment: adjustmentData,
    },
    name: options.name || getAdjustmentName(type),
    visible: options.visible !== false,
    opacity: typeof options.opacity === "number" ? options.opacity : 1,
    blendingMode: options.blendingMode || "normal",
    ...options,
  };
}

export function getAdjustmentName(type) {
  switch (type) {
    case ADJUSTMENT_TYPES.BRIGHTNESS_CONTRAST:
      return "Brightness/Contrast";
    case ADJUSTMENT_TYPES.SATURATION_HUE:
      return "Saturation/Hue";
    default:
      return "Adjustment";
  }
}

export function updateAdjustmentParams(layerId, params) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  if (!layer || layer.type !== "adjustment") {
    return false;
  }

  store.updateSlice(
    "layers",
    (layers) => {
      const entities = { ...layers.entities };
      const entity = { ...entities[layerId] };
      const metadata = { ...entity.metadata };
      const adjustment = { ...(metadata.adjustment || {}) };

      adjustment.params = { ...(adjustment.params || {}), ...params };
      metadata.adjustment = adjustment;
      entity.metadata = metadata;
      entity.updatedAt = Date.now();
      entities[layerId] = entity;

      return { ...layers, entities };
    },
    { reason: "adjustment:update", layerId }
  );

  if (eventBus) {
    eventBus.emit("adjustment:updated", { layerId, params });
  }

  return true;
}

export function toggleAdjustment(layerId) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  if (!layer || layer.type !== "adjustment") {
    return false;
  }

  const adjustment = layer.metadata?.adjustment;
  if (!adjustment) {
    return false;
  }

  store.updateSlice(
    "layers",
    (layers) => {
      const entities = { ...layers.entities };
      const entity = { ...entities[layerId] };
      const metadata = { ...entity.metadata };
      const adjustmentData = { ...(metadata.adjustment || {}) };

      adjustmentData.enabled = !adjustmentData.enabled;
      metadata.adjustment = adjustmentData;
      entity.metadata = metadata;
      entity.updatedAt = Date.now();
      entities[layerId] = entity;

      return { ...layers, entities };
    },
    { reason: "adjustment:toggle", layerId }
  );

  if (eventBus) {
    eventBus.emit("adjustment:toggled", { layerId });
  }

  return true;
}

export function getAdjustment(layerId) {
  const state = store.getState();
  const layer = state.layers?.entities?.[layerId];
  return layer?.metadata?.adjustment || null;
}

export function applyBrightnessContrast(imageData, params = {}) {
  const brightness = typeof params.brightness === "number" ? params.brightness : 0;
  const contrast = typeof params.contrast === "number" ? params.contrast : 0;

  const data = imageData.data;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    // Apply brightness
    let r = data[i] + brightness;
    let g = data[i + 1] + brightness;
    let b = data[i + 2] + brightness;

    // Apply contrast
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    // Clamp values
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  return imageData;
}

export function applySaturationHue(imageData, params = {}) {
  const saturation = typeof params.saturation === "number" ? params.saturation : 0;
  const hue = typeof params.hue === "number" ? params.hue : 0;

  const data = imageData.data;
  const saturationMultiplier = 1 + saturation / 100;
  const hueShift = (hue / 360) * Math.PI * 2;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    // Convert RGB to HSL
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

      if (max === r) {
        h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
      } else if (max === g) {
        h = ((b - r) / delta + 2) / 6;
      } else {
        h = ((r - g) / delta + 4) / 6;
      }
    }

    // Apply hue shift
    h = (h + hueShift / (Math.PI * 2)) % 1;
    if (h < 0) h += 1;

    // Apply saturation
    s = Math.max(0, Math.min(1, s * saturationMultiplier));

    // Convert HSL back to RGB
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    data[i] = Math.max(0, Math.min(255, r * 255));
    data[i + 1] = Math.max(0, Math.min(255, g * 255));
    data[i + 2] = Math.max(0, Math.min(255, b * 255));
  }

  return imageData;
}

export function applyAdjustmentToCanvas(canvas, adjustment) {
  if (!canvas || !adjustment || !adjustment.enabled) {
    return canvas;
  }

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = canvas.width;
  resultCanvas.height = canvas.height;
  const ctx = resultCanvas.getContext("2d");

  if (!ctx) {
    return canvas;
  }

  ctx.drawImage(canvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  switch (adjustment.type) {
    case ADJUSTMENT_TYPES.BRIGHTNESS_CONTRAST:
      applyBrightnessContrast(imageData, adjustment.params);
      break;
    case ADJUSTMENT_TYPES.SATURATION_HUE:
      applySaturationHue(imageData, adjustment.params);
      break;
    default:
      return canvas;
  }

  ctx.putImageData(imageData, 0, 0);
  return resultCanvas;
}

export const adjustmentLayers = {
  ADJUSTMENT_TYPES,
  createAdjustmentLayer,
  getAdjustmentName,
  updateAdjustmentParams,
  toggleAdjustment,
  getAdjustment,
  applyAdjustmentToCanvas,
};
