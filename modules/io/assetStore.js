// In-memory asset store for image canvases associated with layers.
// This avoids storing heavy DOM objects in the application state store.

const assets = new Map();
let sequence = 0;

function nextId(prefix = "asset") {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function registerCanvas(canvas, options = {}) {
  if (!canvas) return null;

  const id = options.id || nextId(options.prefix || "image");
  const record = {
    id,
    canvas,
    width: Number(canvas.width) || 0,
    height: Number(canvas.height) || 0,
    mimeType: options.mimeType || "image/png",
    name: options.name || null,
    createdAt: Date.now(),
    ownerId: options.ownerId || null,
    meta: { ...(options.meta || {}) },
  };

  assets.set(id, record);
  return id;
}

export function getCanvas(assetId) {
  const entry = assets.get(assetId);
  return entry ? entry.canvas : null;
}

export function getInfo(assetId) {
  const entry = assets.get(assetId);
  return entry ? { ...entry, canvas: undefined } : null;
}

export function remove(assetId) {
  assets.delete(assetId);
}

export function clear() {
  assets.clear();
}
