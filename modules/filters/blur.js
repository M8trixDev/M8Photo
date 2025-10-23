// Separable Gaussian Blur filter
// Options: { radius: number } where radius ~ 0..50. Internally uses sigma = Math.max(0.1, radius/3)

import { tryApplyGL } from "../gl/index.js";

function buildKernelFromRadius(radius) {
  const r = Math.max(0, Math.floor(radius));
  if (r <= 0) return new Float32Array([1]);
  const sigma = Math.max(0.1, radius / 3);
  const size = r * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma2 = sigma * sigma;
  let sum = 0;
  for (let i = -r, k = 0; i <= r; i += 1, k += 1) {
    const val = Math.exp(-(i * i) / (2 * sigma2));
    kernel[k] = val;
    sum += val;
  }
  // Normalize
  for (let i = 0; i < size; i += 1) kernel[i] /= sum;
  return kernel;
}

function convolveHorizontal(src, dst, width, height, kernel) {
  const half = (kernel.length - 1) >> 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -half; k <= half; k += 1) {
        const ix = x + k;
        const clampedX = ix < 0 ? 0 : ix >= width ? width - 1 : ix;
        const idx = row + clampedX * 4;
        const w = kernel[k + half];
        r += src[idx] * w;
        g += src[idx + 1] * w;
        b += src[idx + 2] * w;
        a += src[idx + 3] * w;
      }
      const o = row + x * 4;
      dst[o] = r;
      dst[o + 1] = g;
      dst[o + 2] = b;
      dst[o + 3] = a;
    }
  }
}

function convolveVertical(src, dst, width, height, kernel) {
  const half = (kernel.length - 1) >> 1;
  for (let x = 0; x < width; x += 1) {
    const col = x * 4;
    for (let y = 0; y < height; y += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -half; k <= half; k += 1) {
        const iy = y + k;
        const clampedY = iy < 0 ? 0 : iy >= height ? height - 1 : iy;
        const idx = clampedY * width * 4 + col;
        const w = kernel[k + half];
        r += src[idx] * w;
        g += src[idx + 1] * w;
        b += src[idx + 2] * w;
        a += src[idx + 3] * w;
      }
      const o = y * width * 4 + col;
      dst[o] = r;
      dst[o + 1] = g;
      dst[o + 2] = b;
      dst[o + 3] = a;
    }
  }
}

export function applyToImageData(imageData, options = {}) {
  if (!imageData || !imageData.data) return imageData;
  const radius = Math.max(0, Number(options.radius) || 0);
  if (radius <= 0) return imageData;

  const w = imageData.width | 0;
  const h = imageData.height | 0;
  const src = imageData.data;
  const tmp = new Float32Array(src.length);
  const out = new Uint8ClampedArray(src.length);
  const kernel = buildKernelFromRadius(radius);

  convolveHorizontal(src, tmp, w, h, kernel);
  convolveVertical(tmp, out, w, h, kernel);

  // Copy back to ImageData
  imageData.data.set(out);
  return imageData;
}

export function applyToCanvas(sourceCanvas, options = {}) {
  if (!sourceCanvas) return null;

  const glResult = tryApplyGL(sourceCanvas, "blur", options);
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
