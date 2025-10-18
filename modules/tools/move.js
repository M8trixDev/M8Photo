const MOVE_COMMAND_KEY = "tool:move";
const DEFAULT_TRANSFORM = Object.freeze({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
const VALID_SELECTION_MODES = new Set(["replace", "add", "subtract"]);
const EPSILON = 0.0001;

const DEFAULT_MOVE_OPTIONS = Object.freeze({
  snapToGrid: true,
  snapToGuides: true,
  snapTolerance: 6,
  gridSize: 8,
  angleIncrement: 15,
  scaleIncrement: 0.05,
  showHandles: true,
  selectionMode: "replace",
  constrainProportions: false,
});

export function createMoveTool(context) {
  const { store, history, eventBus } = context;

  registerMoveCommand(history, store, eventBus);

  const api = {
    selectLayers,
    transform,
    resetTransform,
    getSelectionBounds,
  };

  function selectLayers(layerIds, options = {}) {
    const ids = normaliseLayerIds(layerIds);
    if (!ids.length) {
      store.updateSlice(
        "selection",
        (selection) => ({ ...selection, items: [], bounds: null, mode: "replace" }),
        { reason: "tools:move-selection-clear" }
      );
      return [];
    }

    const state = store.getState();
    const locked = new Set(
      ids.filter((layerId) => Boolean(state.layers?.entities?.[layerId]?.locked))
    );

    const selectable = ids.filter((layerId) => !locked.has(layerId));

    const mode = VALID_SELECTION_MODES.has(options.mode) ? options.mode : "replace";
    const existing = state.selection?.items || [];
    let nextSelection;

    switch (mode) {
      case "add":
        nextSelection = Array.from(new Set([...existing, ...selectable]));
        break;
      case "subtract":
        nextSelection = existing.filter((id) => !selectable.includes(id));
        break;
      case "replace":
      default:
        nextSelection = selectable;
        break;
    }

    const nextBounds = calculateSelectionBounds(store, nextSelection);

    store.updateSlice(
      "selection",
      (selection) => ({
        ...selection,
        items: nextSelection,
        bounds: nextBounds,
        mode,
      }),
      { reason: "tools:move-selection", tool: "move" }
    );

    if (nextSelection.length) {
      store.updateSlice(
        "layers",
        (layers) => ({
          ...layers,
          active: nextSelection[0],
        }),
        { reason: "tools:move-selection", tool: "move" }
      );
    }

    if (eventBus) {
      eventBus.emit("selection:change", {
        layerIds: nextSelection,
        bounds: nextBounds,
        mode,
        source: "move-tool",
      });
    }

    return nextSelection;
  }

  function transform(parameters = {}) {
    const state = store.getState();
    const activeSelection = state.selection?.items || [];
    const providedIds = normaliseLayerIds(parameters.layerIds);
    const targetLayerIds = providedIds.length ? providedIds : activeSelection;

    if (!targetLayerIds.length) {
      return null;
    }

    const optionsSnapshot = {
      ...DEFAULT_MOVE_OPTIONS,
      ...(state.tools?.options?.move || {}),
      ...(parameters.optionsOverride || {}),
    };

    const payload = {
      layerIds: targetLayerIds,
      delta: normaliseDelta(parameters.delta),
      absolute: normaliseAbsolute(parameters.absolute),
      origin: parameters.origin ? normalisePoint(parameters.origin) : null,
      mode: parameters.mode || "transform",
      optionsSnapshot,
      label: parameters.label,
    };

    return history.execute(MOVE_COMMAND_KEY, payload, {
      meta: {
        tool: "move",
        layerIds: targetLayerIds,
        mode: payload.mode,
        source: parameters.source || "move-api",
      },
    });
  }

  function resetTransform(layerIds, options = {}) {
    const ids = normaliseLayerIds(layerIds);
    if (!ids.length) {
      return null;
    }

    return transform({
      layerIds: ids,
      absolute: DEFAULT_TRANSFORM,
      mode: "reset",
      label: ids.length > 1 ? "Reset Layer Transforms" : "Reset Layer Transform",
      source: options.source || "move-reset",
    });
  }

  function getSelectionBounds(layerIds) {
    const ids = Array.isArray(layerIds) ? layerIds : store.getState().selection?.items;
    return calculateSelectionBounds(store, ids);
  }

  return {
    id: "move",
    label: "Move",
    cursor: "grab",
    getDefaultOptions() {
      return { ...DEFAULT_MOVE_OPTIONS };
    },
    normalizeOptions(nextOptions = {}) {
      return normaliseMoveOptions(nextOptions);
    },
    onActivate(meta) {
      if (eventBus) {
        eventBus.emit("tools:move:activated", { source: meta?.source || "user" });
      }
    },
    onDeactivate(meta) {
      if (eventBus) {
        eventBus.emit("tools:move:deactivated", { source: meta?.source || "user" });
      }
    },
    onOptionsChanged(nextOptions, previousOptions) {
      if (eventBus) {
        eventBus.emit("tools:move:options", {
          options: nextOptions,
          previous: previousOptions,
        });
      }
    },
    getPublicApi() {
      return {
        id: "move",
        selectLayers,
        transform,
        resetTransform,
        getSelectionBounds,
        get options() {
          const options = store.getState().tools?.options?.move || {};
          return { ...options };
        },
      };
    },
  };
}

function registerMoveCommand(history, store, eventBus) {
  if (history.hasCommand(MOVE_COMMAND_KEY)) {
    return;
  }

  history.registerCommand(MOVE_COMMAND_KEY, ({ payload }) => {
    const layerIds = normaliseLayerIds(payload?.layerIds);
    const delta = normaliseDelta(payload?.delta);
    const absolute = normaliseAbsolute(payload?.absolute);
    const origin = payload?.origin ? normalisePoint(payload.origin) : null;
    const optionsSnapshot = normaliseMoveOptions({
      ...DEFAULT_MOVE_OPTIONS,
      ...(payload?.optionsSnapshot || {}),
    });

    return {
      type: MOVE_COMMAND_KEY,
      label: payload?.label || (layerIds.length > 1 ? "Move Layers" : "Move Layer"),
      meta: {
        layerIds,
        mode: payload?.mode || "transform",
        origin,
        tool: "move",
      },
      layerIds,
      delta,
      absolute,
      origin,
      optionsSnapshot,
      beforeTransforms: null,
      afterTransforms: null,
      skipped: false,
      execute({ store: sharedStore }) {
        const before = {};
        const after = {};
        let changed = 0;

        sharedStore.updateSlice(
          "layers",
          (layers) => {
            if (!layerIds.length) {
              return layers;
            }

            const entities = { ...layers.entities };
            let mutated = false;

            layerIds.forEach((layerId) => {
              const layer = layers.entities[layerId];
              if (!layer || layer.locked) {
                return;
              }

              const currentTransform = normaliseTransform(layer.transform);
              before[layerId] = currentTransform;

              const nextTransform = applyTransform(currentTransform, delta, absolute, optionsSnapshot);

              if (!hasTransformChanged(currentTransform, nextTransform)) {
                return;
              }

              after[layerId] = nextTransform;
              const nextLayer = {
                ...layer,
                transform: nextTransform,
                updatedAt: Date.now(),
              };
              entities[layerId] = nextLayer;
              mutated = true;
              changed += 1;
            });

            if (!mutated) {
              return layers;
            }

            return {
              ...layers,
              entities,
            };
          },
          { reason: "tools:move-transform", layerIds }
        );

        this.beforeTransforms = before;

        if (!changed) {
          this.skipped = true;
          return null;
        }

        this.skipped = false;
        this.afterTransforms = after;

        refreshSelectionBounds(sharedStore, layerIds);

        if (eventBus) {
          eventBus.emit("layers:transformed", {
            layerIds,
            transforms: after,
            source: "move",
          });
        }

        return after;
      },
      undo({ store: sharedStore }) {
        if (this.skipped || !this.beforeTransforms) {
          return null;
        }

        const transforms = this.beforeTransforms;

        sharedStore.updateSlice(
          "layers",
          (layers) => {
            const entities = { ...layers.entities };
            let mutated = false;

            Object.keys(transforms).forEach((layerId) => {
              const layer = layers.entities[layerId];
              if (!layer) {
                return;
              }
              entities[layerId] = {
                ...layer,
                transform: transforms[layerId],
                updatedAt: Date.now(),
              };
              mutated = true;
            });

            if (!mutated) {
              return layers;
            }

            return {
              ...layers,
              entities,
            };
          },
          { reason: "tools:move-undo", layerIds }
        );

        refreshSelectionBounds(sharedStore, Object.keys(transforms));

        if (eventBus) {
          eventBus.emit("layers:transformed", {
            layerIds: Object.keys(transforms),
            transforms,
            source: "move",
            undo: true,
          });
        }

        return transforms;
      },
      redo({ store: sharedStore }) {
        if (this.skipped || !this.afterTransforms) {
          return null;
        }

        const transforms = this.afterTransforms;

        sharedStore.updateSlice(
          "layers",
          (layers) => {
            const entities = { ...layers.entities };
            let mutated = false;

            Object.keys(transforms).forEach((layerId) => {
              const layer = layers.entities[layerId];
              if (!layer) {
                return;
              }
              entities[layerId] = {
                ...layer,
                transform: transforms[layerId],
                updatedAt: Date.now(),
              };
              mutated = true;
            });

            if (!mutated) {
              return layers;
            }

            return {
              ...layers,
              entities,
            };
          },
          { reason: "tools:move-redo", layerIds }
        );

        refreshSelectionBounds(sharedStore, Object.keys(transforms));

        if (eventBus) {
          eventBus.emit("layers:transformed", {
            layerIds: Object.keys(transforms),
            transforms,
            source: "move",
            redo: true,
          });
        }

        return transforms;
      },
    };
  });
}

function normaliseMoveOptions(options) {
  const next = { ...DEFAULT_MOVE_OPTIONS, ...(options || {}) };
  next.snapToGrid = Boolean(next.snapToGrid);
  next.snapToGuides = Boolean(next.snapToGuides);
  next.snapTolerance = clampNumber(next.snapTolerance, 0, 24);
  next.gridSize = clampNumber(next.gridSize, 1, 256);
  next.angleIncrement = clampNumber(next.angleIncrement, 1, 90);
  next.scaleIncrement = clampNumber(next.scaleIncrement, 0, 1);
  next.showHandles = next.showHandles !== false;
  next.selectionMode = VALID_SELECTION_MODES.has(next.selectionMode) ? next.selectionMode : "replace";
  next.constrainProportions = Boolean(next.constrainProportions);
  return next;
}

function normaliseLayerIds(layerIds) {
  if (!Array.isArray(layerIds)) {
    return [];
  }

  return Array.from(new Set(layerIds.map(String))).filter((id) => id.trim() !== "");
}

function normaliseDelta(delta) {
  if (!delta || typeof delta !== "object") {
    return null;
  }

  const next = {};
  if (typeof delta.x === "number") next.x = delta.x;
  if (typeof delta.y === "number") next.y = delta.y;
  if (typeof delta.rotation === "number") next.rotation = delta.rotation;
  if (typeof delta.scaleX === "number") next.scaleX = delta.scaleX;
  if (typeof delta.scaleY === "number") next.scaleY = delta.scaleY;

  return Object.keys(next).length ? next : null;
}

function normaliseAbsolute(absolute) {
  if (!absolute || typeof absolute !== "object") {
    return null;
  }

  const next = {};
  if (typeof absolute.x === "number") next.x = absolute.x;
  if (typeof absolute.y === "number") next.y = absolute.y;
  if (typeof absolute.rotation === "number") next.rotation = absolute.rotation;
  if (typeof absolute.scaleX === "number") next.scaleX = absolute.scaleX;
  if (typeof absolute.scaleY === "number") next.scaleY = absolute.scaleY;

  return Object.keys(next).length ? next : null;
}

function normalisePoint(point) {
  if (!point || typeof point !== "object") {
    return { x: 0, y: 0 };
  }

  return {
    x: typeof point.x === "number" ? point.x : 0,
    y: typeof point.y === "number" ? point.y : 0,
  };
}

function normaliseTransform(transform) {
  if (!transform || typeof transform !== "object") {
    return { ...DEFAULT_TRANSFORM };
  }

  return {
    x: typeof transform.x === "number" ? transform.x : 0,
    y: typeof transform.y === "number" ? transform.y : 0,
    rotation: typeof transform.rotation === "number" ? transform.rotation : 0,
    scaleX: typeof transform.scaleX === "number" ? transform.scaleX : 1,
    scaleY: typeof transform.scaleY === "number" ? transform.scaleY : 1,
  };
}

function applyTransform(current, delta, absolute, options) {
  const next = { ...current };

  if (absolute) {
    if (typeof absolute.x === "number") next.x = absolute.x;
    if (typeof absolute.y === "number") next.y = absolute.y;
    if (typeof absolute.rotation === "number") next.rotation = absolute.rotation;
    if (typeof absolute.scaleX === "number") next.scaleX = absolute.scaleX;
    if (typeof absolute.scaleY === "number") next.scaleY = absolute.scaleY;
  }

  const constrained = options?.constrainProportions;

  if (delta) {
    if (typeof delta.x === "number") next.x += delta.x;
    if (typeof delta.y === "number") next.y += delta.y;
    if (typeof delta.rotation === "number") next.rotation += delta.rotation;

    if (constrained && (typeof delta.scaleX === "number" || typeof delta.scaleY === "number")) {
      const applied =
        typeof delta.scaleX === "number"
          ? current.scaleX + delta.scaleX
          : typeof delta.scaleY === "number"
            ? current.scaleY + delta.scaleY
            : current.scaleX;
      next.scaleX = applied;
      next.scaleY = applied;
    } else {
      if (typeof delta.scaleX === "number") next.scaleX += delta.scaleX;
      if (typeof delta.scaleY === "number") next.scaleY += delta.scaleY;
    }
  }

  next.scaleX = clampNumber(next.scaleX, 0.01, 100);
  next.scaleY = clampNumber(next.scaleY, 0.01, 100);
  next.rotation = normaliseRotation(next.rotation);

  return applySnapping(next, options);
}

function applySnapping(transform, options) {
  if (!options) {
    return transform;
  }

  const result = { ...transform };
  const tolerance = typeof options.snapTolerance === "number" ? Math.max(0, options.snapTolerance) : 0;

  if (options.snapToGrid) {
    result.x = snapToIncrement(result.x, options.gridSize, tolerance);
    result.y = snapToIncrement(result.y, options.gridSize, tolerance);
  }

  if (options.snapToGuides) {
    result.rotation = snapToIncrement(result.rotation, options.angleIncrement, tolerance || options.angleIncrement / 4);
  }

  if (options.snapToGrid || options.snapToGuides) {
    if (options.scaleIncrement > 0) {
      result.scaleX = snapScale(result.scaleX, options.scaleIncrement, tolerance / 100);
      result.scaleY = snapScale(result.scaleY, options.scaleIncrement, tolerance / 100);
    }
  }

  return result;
}

function snapToIncrement(value, increment, tolerance) {
  if (typeof value !== "number" || !isFinite(value)) {
    return 0;
  }

  const step = typeof increment === "number" && increment > 0 ? increment : 1;
  const snapped = Math.round(value / step) * step;

  if (!tolerance || Math.abs(value - snapped) <= tolerance) {
    return snapped;
  }

  return value;
}

function snapScale(value, increment, tolerance) {
  if (typeof value !== "number" || !isFinite(value)) {
    return 1;
  }

  const step = typeof increment === "number" && increment > 0 ? increment : 0;

  if (!step) {
    return clampNumber(value, 0.01, 100);
  }

  const snapped = snapToIncrement(value, step, tolerance || step / 2);
  return clampNumber(snapped, 0.01, 100);
}

function normaliseRotation(value) {
  if (typeof value !== "number" || !isFinite(value)) {
    return 0;
  }

  let rotation = value % 360;
  if (rotation < -180) {
    rotation += 360;
  } else if (rotation > 180) {
    rotation -= 360;
  }
  return rotation;
}

function hasTransformChanged(previous, next) {
  if (!previous || !next) {
    return false;
  }

  return (
    !approximatelyEqual(previous.x, next.x) ||
    !approximatelyEqual(previous.y, next.y) ||
    !approximatelyEqual(previous.rotation, next.rotation) ||
    !approximatelyEqual(previous.scaleX, next.scaleX) ||
    !approximatelyEqual(previous.scaleY, next.scaleY)
  );
}

function approximatelyEqual(a, b) {
  return Math.abs(a - b) <= EPSILON;
}

function clampNumber(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }

  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function calculateSelectionBounds(store, layerIds) {
  const ids = Array.isArray(layerIds) ? layerIds : [];
  if (!ids.length) {
    return null;
  }

  const state = store.getState();
  const layers = state.layers?.entities || {};

  const boundsList = ids
    .map((id) => layers[id])
    .filter(Boolean)
    .map((layer) => computeLayerBounds(layer));

  if (!boundsList.length) {
    return null;
  }

  const left = Math.min(...boundsList.map((bounds) => bounds.left));
  const top = Math.min(...boundsList.map((bounds) => bounds.top));
  const right = Math.max(...boundsList.map((bounds) => bounds.right));
  const bottom = Math.max(...boundsList.map((bounds) => bounds.bottom));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function refreshSelectionBounds(sharedStore, affectedLayerIds) {
  if (!sharedStore || typeof sharedStore.getState !== "function") {
    return;
  }

  const selectionState = sharedStore.getState().selection;

  if (!selectionState || !Array.isArray(selectionState.items) || selectionState.items.length === 0) {
    return;
  }

  if (
    Array.isArray(affectedLayerIds) &&
    affectedLayerIds.length &&
    !affectedLayerIds.some((id) => selectionState.items.includes(id))
  ) {
    return;
  }

  const nextBounds = calculateSelectionBounds(sharedStore, selectionState.items);

  sharedStore.updateSlice(
    "selection",
    (selection) => {
      if (!selection || !Array.isArray(selection.items) || selection.items.length === 0) {
        return selection;
      }

      if (!nextBounds) {
        if (selection.bounds === null) {
          return selection;
        }
        return { ...selection, bounds: null };
      }

      if (boundsEqual(selection.bounds, nextBounds)) {
        return selection;
      }

      return { ...selection, bounds: nextBounds };
    },
    { reason: "tools:move-selection-bounds" }
  );
}

function boundsEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  const keys = ["left", "top", "right", "bottom", "width", "height"];
  return keys.every((key) => approximatelyEqual(a[key] ?? 0, b[key] ?? 0));
}

function computeLayerBounds(layer) {
  const transform = normaliseTransform(layer?.transform);
  const dimensions = layer?.dimensions || layer?.size || { width: 512, height: 512 };
  const width = (dimensions?.width || 0) * transform.scaleX;
  const height = (dimensions?.height || 0) * transform.scaleY;
  const rotation = (transform.rotation || 0) * (Math.PI / 180);
  const centerX = transform.x + width / 2;
  const centerY = transform.y + height / 2;

  if (Math.abs(rotation) < EPSILON) {
    return {
      left: transform.x,
      top: transform.y,
      right: transform.x + width,
      bottom: transform.y + height,
    };
  }

  const corners = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map(({ x, y }) => rotatePoint(x, y, rotation));

  const xs = corners.map((corner) => corner.x + centerX);
  const ys = corners.map((corner) => corner.y + centerY);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function rotatePoint(x, y, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}
