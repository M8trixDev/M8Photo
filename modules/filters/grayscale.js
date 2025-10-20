// Grayscale filter with adjustable amount
// Options: { amount: 0..100 }

import { tryApplyGL } from "../gl/index.js";

export function applyToImageData(imageData, options = {}) {
  if (!imageData || !imageData.data) return imageData;
  const amt = Math.max(0, Math.min(100, options.amount == null ? 100 : options.amount)) / 100; // 0..1
  const data = imageData.data;
  const len = data.length;

  if (amt === 1) {
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      data[i] = data[i + 1] = data[i + 2] = y;
    }
    return imageData;
  }

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    data[i] = Math.round(r + (y - r) * amt);
    data[i + 1] = Math.round(g + (y - g) * amt);
    data[i + 2] = Math.round(b + (y - b) * amt);
  }
  return imageData;
}

export function applyToCanvas(sourceCanvas, options = {}) {
  if (!sourceCanvas) return null;

  // Use WebGL path for full grayscale when available
  if (options.amount == null || Number(options.amount) >= 100) {
    const glResult = tryApplyGL(sourceCanvas, 'grayscale', options);
    if (glResult) return glResult;
  }

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
