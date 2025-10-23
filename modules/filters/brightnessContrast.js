// Brightness/Contrast filter implementation
// Options: { brightness: -100..100, contrast: -100..100 }

import { tryApplyGL } from "../gl/index.js";

export function applyToImageData(imageData, options = {}) {
  if (!imageData || !imageData.data) return imageData;
  const { brightness = 0, contrast = 0 } = options;

  const data = imageData.data;
  const len = data.length;

  // Map [-100, 100] -> [-255, 255] offset
  const offset = Math.max(-255, Math.min(255, (brightness / 100) * 255));
  // Contrast factor: simple linear scale 1 + c/100
  // For stronger curve, could use: (259*(c+255))/(255*(259-c)) where c in [-255,255]
  const cNorm = Math.max(-100, Math.min(100, contrast));
  const factor = 1 + cNorm / 100;

  for (let i = 0; i < len; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Apply contrast around mid-point then brightness offset
    r = (r - 128) * factor + 128 + offset;
    g = (g - 128) * factor + 128 + offset;
    b = (b - 128) * factor + 128 + offset;

    data[i] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  }
  return imageData;
}

export function applyToCanvas(sourceCanvas, options = {}) {
  if (!sourceCanvas) return null;
  
  // Try WebGL path first
  const glResult = tryApplyGL(sourceCanvas, "brightnessContrast", options);
  if (glResult) {
    return glResult;
  }
  
  // Fall back to Canvas2D
  const w = sourceCanvas.width | 0;
  const h = sourceCanvas.height | 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sourceCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const out = applyToImageData(imageData, options);
  ctx.putImageData(out, 0, 0);
  return canvas;
}
