// Saturation and Hue adjustment filter
// Options: { saturation: -100..100, hue: -180..180 }

import { tryApplyGL } from "../gl/index.js";

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  } else {
    s = 0; h = 0;
  }
  return [h, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function applyToImageData(imageData, options = {}) {
  if (!imageData || !imageData.data) return imageData;
  const { saturation = 0, hue = 0 } = options;
  const sDelta = Math.max(-100, Math.min(100, saturation)) / 100; // -1..1 (relative)
  const hDelta = (Math.max(-180, Math.min(180, hue)) / 360); // -0.5..0.5 cycles

  const data = imageData.data;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let [h, s, l] = rgbToHsl(r, g, b);

    // Adjust Hue and Saturation
    h = (h + hDelta) % 1;
    if (h < 0) h += 1;
    s = Math.max(0, Math.min(1, s + sDelta));

    const [nr, ng, nb] = hslToRgb(h, s, l);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
  return imageData;
}

export function applyToCanvas(sourceCanvas, options = {}) {
  if (!sourceCanvas) return null;

  const glResult = tryApplyGL(sourceCanvas, "saturationHue", options);
  if (glResult) {
    return glResult;
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
