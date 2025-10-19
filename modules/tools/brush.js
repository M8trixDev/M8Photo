const STROKE_COMMAND_KEY = "tool:stroke";
const DEFAULT_BRUSH_OPTIONS = Object.freeze({
  size: 32,
  hardness: 0.75,
  opacity: 0.9,
  smoothing: 0.25,
  spacing: 0.16,
  flow: 0.9,
  texture: false,
});

let strokeSequence = 0;

export function createBrushTool(context) {
  const { store, history, eventBus } = context;

  registerStrokeCommand(history, store, eventBus);

  function commitStroke(params = {}) {
    const {
      layerId,
      strokeId = createStrokeId(params.toolId || "brush"),
      points = [],
      options = {},
      toolId = "brush",
      composite,
      coalesceWindow,
      meta = {},
    } = params;

    if (!layerId || !Array.isArray(points) || points.length === 0) {
      return strokeId;
    }

    const state = store.getState();
    const baseOptions = {
      ...DEFAULT_BRUSH_OPTIONS,
      ...(state.tools?.options?.[toolId] || {}),
      ...options,
    };

    const optionsSnapshot = normaliseBrushOptions(baseOptions);
    const processedPoints = processStrokePoints(points, optionsSnapshot);

    if (!processedPoints.length) {
      return strokeId;
    }

    history.execute(
      STROKE_COMMAND_KEY,
      {
        layerId,
        strokeId,
        toolId,
        composite: composite || (toolId === "eraser" ? "destination-out" : "source-over"),
        points: processedPoints,
        processed: true,
        optionsSnapshot,
        coalesceWindow,
      },
      {
        meta: {
          ...meta,
          tool: toolId,
          layerId,
          strokeId,
          pointCount: processedPoints.length,
        },
      }
    );

    return strokeId;
  }

  function samplePoints(points, overrides = {}) {
    const options = normaliseBrushOptions({ ...DEFAULT_BRUSH_OPTIONS, ...overrides });
    return processStrokePoints(points, options);
  }

  return {
    id: "brush",
    label: "Brush",
    cursor: "crosshair",
    getDefaultOptions() {
      return { ...DEFAULT_BRUSH_OPTIONS };
    },
    normalizeOptions(options = {}) {
      return normaliseBrushOptions({ ...DEFAULT_BRUSH_OPTIONS, ...options });
    },
    onActivate(meta) {
      if (eventBus) {
        eventBus.emit("tools:brush:activated", { source: meta?.source || "user" });
      }
    },
    onDeactivate(meta) {
      if (eventBus) {
        eventBus.emit("tools:brush:deactivated", { source: meta?.source || "user" });
      }
    },
    onOptionsChanged(next, previous) {
      if (eventBus) {
        eventBus.emit("tools:brush:options", { options: next, previous });
      }
    },
    getPublicApi() {
      return {
        id: "brush",
        commitStroke,
        samplePoints,
        get options() {
          const options = store.getState().tools?.options?.brush || {};
          return { ...options };
        },
      };
    },
    commitStroke,
    samplePoints,
  };
}

function registerStrokeCommand(history, store, eventBus) {
  if (history.hasCommand(STROKE_COMMAND_KEY)) {
    return;
  }

  history.registerCommand(STROKE_COMMAND_KEY, ({ payload }) => {
    const layerId = payload?.layerId;
    const strokeId = payload?.strokeId || createStrokeId(payload?.toolId || "brush");
    const toolId = payload?.toolId || "brush";
    const composite = payload?.composite || (toolId === "eraser" ? "destination-out" : "source-over");
    const optionsSnapshot = normaliseBrushOptions({
      ...DEFAULT_BRUSH_OPTIONS,
      ...(payload?.optionsSnapshot || {}),
    });

    const rawPoints = Array.isArray(payload?.points) ? payload.points : [];
    const processedPoints = payload?.processed
      ? rawPoints.map((point) => ({ ...point }))
      : processStrokePoints(rawPoints, optionsSnapshot);

    return {
      type: STROKE_COMMAND_KEY,
      label: toolId === "eraser" ? "Erase Stroke" : "Brush Stroke",
      meta: {
        layerId,
        strokeId,
        tool: toolId,
        pointCount: processedPoints.length,
      },
      options: {
        coalesce: true,
        coalesceKey: `${toolId}:${layerId}:${strokeId}`,
        coalesceWindow: Math.max(120, Number(payload?.coalesceWindow) || 240),
      },
      layerId,
      strokeId,
      toolId,
      composite,
      optionsSnapshot,
      points: processedPoints,
      skipped: false,
      execute({ store: sharedStore }) {
        if (!layerId || !this.points.length) {
          this.skipped = true;
          return null;
        }

        const applied = applyStrokeToLayer(sharedStore, {
          layerId,
          strokeId,
          toolId,
          composite,
          optionsSnapshot,
          points: this.points,
        });

        this.skipped = applied <= 0;

        if (applied > 0 && eventBus) {
          eventBus.emit("tools:stroke:applied", {
            tool: toolId,
            layerId,
            strokeId,
            pointCount: applied,
          });
        }

        return applied;
      },
      undo({ store: sharedStore }) {
        if (this.skipped || !this.points.length) {
          return null;
        }

        const reverted = revertStrokePoints(sharedStore, {
          layerId,
          strokeId,
          pointCount: this.points.length,
        });

        if (reverted > 0 && eventBus) {
          eventBus.emit("tools:stroke:reverted", {
            tool: this.toolId,
            layerId,
            strokeId,
            pointCount: reverted,
          });
        }

        return reverted;
      },
      redo({ store: sharedStore }) {
        if (this.skipped || !this.points.length) {
          return null;
        }

        const applied = applyStrokeToLayer(sharedStore, {
          layerId,
          strokeId,
          toolId,
          composite,
          optionsSnapshot,
          points: this.points,
        });

        if (applied > 0 && eventBus) {
          eventBus.emit("tools:stroke:applied", {
            tool: toolId,
            layerId,
            strokeId,
            pointCount: applied,
            redo: true,
          });
        }

        return applied;
      },
      coalesceWith(otherCommand) {
        if (!otherCommand || otherCommand.layerId !== layerId || otherCommand.strokeId !== strokeId) {
          return false;
        }

        if (!Array.isArray(otherCommand.points) || !otherCommand.points.length) {
          return false;
        }

        this.points = [...this.points, ...otherCommand.points];
        this.meta.pointCount = (this.meta.pointCount || 0) + otherCommand.points.length;
        return true;
      },
    };
  });
}

function normaliseBrushOptions(options) {
  const next = { ...DEFAULT_BRUSH_OPTIONS, ...(options || {}) };
  next.size = clampNumber(next.size, 1, 512);
  next.hardness = clampNumber(next.hardness, 0, 1);
  next.opacity = clampNumber(next.opacity, 0, 1);
  next.smoothing = clampNumber(next.smoothing, 0, 0.95);
  next.spacing = clampNumber(next.spacing, 0.01, 1);
  next.flow = clampNumber(typeof next.flow === "number" ? next.flow : next.opacity, 0, 1);
  return next;
}

function processStrokePoints(points, options) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const normalised = points.map(normalisePoint);
  const sampled = sampleStrokePoints(normalised, options);
  const smoothed = smoothStrokePoints(sampled, options.smoothing);
  return smoothed;
}

function sampleStrokePoints(points, options) {
  const spacing = Math.max(0.5, options.size * options.spacing);
  const sampled = [];
  let lastPoint = null;

  for (const point of points) {
    if (!lastPoint) {
      sampled.push(point);
      lastPoint = point;
      continue;
    }

    if (distanceBetween(point, lastPoint) >= spacing) {
      sampled.push(point);
      lastPoint = point;
    }
  }

  if (sampled.length === 1 && points.length > 1) {
    sampled.push(points[points.length - 1]);
  }

  return sampled;
}

function smoothStrokePoints(points, smoothing) {
  if (!points.length || smoothing <= 0) {
    return points;
  }

  const factor = clampNumber(smoothing, 0, 0.95);
  const smoothed = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = smoothed[index - 1];
    const target = points[index];
    const weight = 1 - factor;

    smoothed.push({
      x: previous.x + (target.x - previous.x) * weight,
      y: previous.y + (target.y - previous.y) * weight,
      pressure: previous.pressure + (target.pressure - previous.pressure) * weight,
      timestamp: target.timestamp,
    });
  }

  return smoothed;
}

function normalisePoint(point) {
  if (!point || typeof point !== "object") {
    return { x: 0, y: 0, pressure: 1, timestamp: Date.now() };
  }

  return {
    x: typeof point.x === "number" && isFinite(point.x) ? point.x : 0,
    y: typeof point.y === "number" && isFinite(point.y) ? point.y : 0,
    pressure: clampNumber(typeof point.pressure === "number" ? point.pressure : 1, 0, 1),
    timestamp: typeof point.timestamp === "number" ? point.timestamp : Date.now(),
  };
}

function distanceBetween(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function applyStrokeToLayer(store, payload) {
  const { layerId, strokeId, points, toolId, composite, optionsSnapshot } = payload;
  if (!Array.isArray(points) || points.length === 0) {
    return 0;
  }

  let applied = 0;

  store.updateSlice(
    "layers",
    (layers) => {
      const layer = layers.entities?.[layerId];
      if (!layer || layer.locked) {
        return layers;
      }

      const entities = { ...layers.entities };
      const strokes = Array.isArray(layer.strokes) ? layer.strokes.slice() : [];
      const timestamp = Date.now();

      let pointCopies = points.map((point) => ({ ...point }));

      // Clip to selection region (world space)
      try {
        const selection = store.getState().selection || {};
        const region = selection.region || null;
        if (region && region.width > 0 && region.height > 0) {
          pointCopies = pointCopies.filter((p) => {
            const world = layerLocalToWorld(p.x, p.y, layer);
            return (
              world.x >= region.x && world.x <= region.x + region.width &&
              world.y >= region.y && world.y <= region.y + region.height
            );
          });
        }
      } catch (_) {}

      if (pointCopies.length === 0) {
        applied = 0;
        return layers;
      }

      const existingIndex = strokes.findIndex((stroke) => stroke.id === strokeId);

      if (existingIndex === -1) {
        // Store stroke points in append-only segments to avoid copying large arrays on every update
        strokes.push({
          id: strokeId,
          tool: toolId,
          composite,
          options: { ...optionsSnapshot },
          // Use segments to minimise memory churn; draw routines will handle both shapes and segments
          pointsSegments: [pointCopies],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } else {
        const existing = strokes[existingIndex];
        const existingSegments = Array.isArray(existing.pointsSegments)
          ? existing.pointsSegments
          : Array.isArray(existing.points)
          ? [existing.points]
          : [];
        strokes[existingIndex] = {
          ...existing,
          options: { ...existing.options, ...optionsSnapshot },
          pointsSegments: [...existingSegments, pointCopies],
          updatedAt: timestamp,
        };
      }

      applied = pointCopies.length;

      entities[layerId] = {
        ...layer,
        strokes,
        lastStrokeId: strokeId,
        updatedAt: timestamp,
      };

      return {
        ...layers,
        entities,
      };
    },
    { reason: `tools:${toolId}-stroke`, strokeId, layerId }
  );

  return applied;
}

function layerLocalToWorld(x, y, layer) {
  const t = layer.transform || {};
  const d = layer.dimensions || {};
  const width = d.width || 0;
  const height = d.height || 0;
  const scaleX = typeof t.scaleX === "number" ? t.scaleX : 1;
  const scaleY = typeof t.scaleY === "number" ? t.scaleY : 1;
  const rotation = ((typeof t.rotation === "number" ? t.rotation : 0) * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  // Scale
  let px = x * scaleX;
  let py = y * scaleY;
  // Translate to center for rotation
  px -= cx;
  py -= cy;
  if (Math.abs(rotation) > 1e-6) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx;
    py = ry;
  }
  // Back from center and apply translation
  px += cx + (t.x || 0);
  py += cy + (t.y || 0);
  return { x: px, y: py };
}

function revertStrokePoints(store, payload) {
  const { layerId, strokeId, pointCount } = payload;

  if (!pointCount) {
    return 0;
  }

  let reverted = 0;

  store.updateSlice(
    "layers",
    (layers) => {
      const layer = layers.entities?.[layerId];
      if (!layer) {
        return layers;
      }

      const strokes = Array.isArray(layer.strokes) ? layer.strokes.slice() : [];
      const index = strokes.findIndex((stroke) => stroke.id === strokeId);

      if (index === -1) {
        return layers;
      }

      const stroke = strokes[index];

      // Support both old single-array representation and new segmented representation
      const hasSegments = Array.isArray(stroke.pointsSegments);
      if (hasSegments) {
        const segments = stroke.pointsSegments.slice();
        let remaining = Math.max(0, pointCount);
        let newSegments = segments.slice();

        // Walk from the end removing points until remaining is depleted
        for (let s = newSegments.length - 1; s >= 0 && remaining > 0; s -= 1) {
          const seg = newSegments[s] || [];
          if (remaining >= seg.length) {
            remaining -= seg.length;
            newSegments.splice(s, 1);
          } else {
            // Trim the last segment
            const keep = seg.length - remaining;
            newSegments[s] = seg.slice(0, keep);
            remaining = 0;
          }
        }

        const beforeCount = stroke.pointsSegments.reduce((acc, seg) => acc + (Array.isArray(seg) ? seg.length : 0), 0);
        const afterCount = newSegments.reduce((acc, seg) => acc + (Array.isArray(seg) ? seg.length : 0), 0);
        reverted = Math.max(0, beforeCount - afterCount);

        if (afterCount === 0) {
          strokes.splice(index, 1);
        } else {
          strokes[index] = {
            ...stroke,
            pointsSegments: newSegments,
            updatedAt: Date.now(),
          };
        }
      } else {
        const pointsArray = Array.isArray(stroke.points) ? stroke.points : [];
        const nextPoints = pointsArray.slice(0, Math.max(0, pointsArray.length - pointCount));
        reverted = pointsArray.length - nextPoints.length;
        if (nextPoints.length === 0) {
          strokes.splice(index, 1);
        } else {
          strokes[index] = {
            ...stroke,
            points: nextPoints,
            updatedAt: Date.now(),
          };
        }
      }

      return {
        ...layers,
        entities: {
          ...layers.entities,
          [layerId]: {
            ...layer,
            strokes,
            updatedAt: Date.now(),
          },
        },
      };
    },
    { reason: "tools:stroke-revert", strokeId, layerId }
  );

  return reverted;
}

function clampNumber(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }

  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function createStrokeId(toolId) {
  strokeSequence += 1;
  const prefix = typeof toolId === "string" ? toolId : "stroke";
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${strokeSequence}`;
}
