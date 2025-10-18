const DEFAULT_ERASER_OPTIONS = Object.freeze({
  size: 48,
  hardness: 0.35,
  opacity: 1,
  smoothing: 0.2,
  spacing: 0.18,
  flow: 1,
});

export function createEraserTool(context) {
  const { store, eventBus, brushTool } = context;

  if (!brushTool || typeof brushTool.commitStroke !== "function") {
    throw new TypeError("Eraser tool requires an initialised brush tool");
  }

  function commitStroke(params = {}) {
    const strokePayload = {
      ...params,
      toolId: "eraser",
      composite: "destination-out",
    };
    return brushTool.commitStroke(strokePayload);
  }

  function samplePoints(points, overrides = {}) {
    return brushTool.samplePoints(points, { ...DEFAULT_ERASER_OPTIONS, ...overrides });
  }

  return {
    id: "eraser",
    label: "Eraser",
    cursor: "crosshair",
    getDefaultOptions() {
      return { ...DEFAULT_ERASER_OPTIONS };
    },
    normalizeOptions(options = {}) {
      return normaliseEraserOptions(options);
    },
    onActivate(meta) {
      if (eventBus) {
        eventBus.emit("tools:eraser:activated", { source: meta?.source || "user" });
      }
    },
    onDeactivate(meta) {
      if (eventBus) {
        eventBus.emit("tools:eraser:deactivated", { source: meta?.source || "user" });
      }
    },
    onOptionsChanged(next, previous) {
      if (eventBus) {
        eventBus.emit("tools:eraser:options", { options: next, previous });
      }
    },
    getPublicApi() {
      return {
        id: "eraser",
        commitStroke,
        samplePoints,
        get options() {
          const options = store.getState().tools?.options?.eraser || {};
          return { ...options };
        },
      };
    },
    commitStroke,
    samplePoints,
  };
}

function normaliseEraserOptions(options) {
  const next = { ...DEFAULT_ERASER_OPTIONS, ...(options || {}) };
  next.size = clampNumber(next.size, 4, 512);
  next.hardness = clampNumber(next.hardness, 0, 1);
  next.opacity = clampNumber(next.opacity, 0, 1);
  next.smoothing = clampNumber(next.smoothing, 0, 0.95);
  next.spacing = clampNumber(next.spacing, 0.05, 1);
  next.flow = 1;
  return next;
}

function clampNumber(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
