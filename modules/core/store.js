import { eventBus } from "./events.js";

const DEFAULT_HISTORY_CAPACITY = 100;

const hasStructuredClone = typeof structuredClone === "function";

function cloneValue(value) {
  if (hasStructuredClone) {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  Object.getOwnPropertyNames(value).forEach((key) => {
    deepFreeze(value[key]);
  });

  return value;
}

function mergeDeep(target, source) {
  if (!isPlainObject(source)) {
    return cloneValue(source);
  }

  const output = isPlainObject(target) ? { ...target } : {};

  Object.keys(source).forEach((key) => {
    const value = source[key];

    if (Array.isArray(value)) {
      output[key] = value.map((item) => (isPlainObject(item) ? mergeDeep({}, item) : cloneValue(item)));
      return;
    }

    if (isPlainObject(value)) {
      output[key] = mergeDeep(output[key], value);
      return;
    }

    output[key] = value;
  });

  return output;
}

const DEFAULT_LAYER_DEFINITIONS = [
  {
    id: "layer-hero",
    name: "Hero Retouch",
    type: "raster",
    locked: false,
    visible: true,
    opacity: 1,
    blendingMode: "normal",
    transform: { x: 160, y: 120, rotation: 0, scaleX: 1, scaleY: 1 },
    dimensions: { width: 960, height: 540 },
    strokes: [],
  },
  {
    id: "layer-gradient",
    name: "Gradient Overlay",
    type: "adjustment",
    locked: false,
    visible: true,
    opacity: 0.82,
    blendingMode: "screen",
    transform: { x: 120, y: 72, rotation: 0, scaleX: 1, scaleY: 1 },
    dimensions: { width: 960, height: 540 },
    strokes: [],
  },
  {
    id: "layer-backdrop",
    name: "Backdrop Blur",
    type: "effect",
    locked: true,
    visible: true,
    opacity: 1,
    blendingMode: "normal",
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    dimensions: { width: 1280, height: 720 },
    strokes: [],
  },
];

const LAYER_BOUNDS_EPSILON = 0.0001;

export const DEFAULT_VIEWPORT_GRID = Object.freeze({
  visible: true,
  size: 32,
  subdivisions: 4,
  color: "rgba(255, 255, 255, 0.16)",
  subdivisionColor: "rgba(255, 255, 255, 0.08)",
});

function buildDefaultLayerState() {
  const order = [];
  const entities = {};
  const stats = { count: 0, visible: 0 };

  DEFAULT_LAYER_DEFINITIONS.forEach((definition) => {
    const id = String(definition.id);
    const entity = {
      id,
      name: definition.name || "Layer",
      type: definition.type || "raster",
      locked: Boolean(definition.locked),
      visible: definition.visible !== false,
      opacity: clampUnit(definition.opacity ?? 1),
      blendingMode: definition.blendingMode || "normal",
      transform: {
        x: typeof definition.transform?.x === "number" ? definition.transform.x : 0,
        y: typeof definition.transform?.y === "number" ? definition.transform.y : 0,
        rotation: typeof definition.transform?.rotation === "number" ? definition.transform.rotation : 0,
        scaleX: typeof definition.transform?.scaleX === "number" ? definition.transform.scaleX : 1,
        scaleY: typeof definition.transform?.scaleY === "number" ? definition.transform.scaleY : 1,
      },
      dimensions: {
        width: typeof definition.dimensions?.width === "number" ? definition.dimensions.width : 512,
        height: typeof definition.dimensions?.height === "number" ? definition.dimensions.height : 512,
      },
      strokes: Array.isArray(definition.strokes) ? definition.strokes.slice() : [],
      metadata: { ...(definition.metadata || {}) },
      createdAt: definition.createdAt ?? null,
      updatedAt: definition.updatedAt ?? null,
    };

    order.push(id);
    entities[id] = entity;
    stats.count += 1;
    if (entity.visible) {
      stats.visible += 1;
    }
  });

  return {
    order,
    entities,
    stats,
    active: order[0] || null,
  };
}

export function calculateBoundsForLayerIds(entities, layerIds) {
  if (!Array.isArray(layerIds) || layerIds.length === 0) {
    return null;
  }

  const bounds = layerIds
    .map((id) => entities[id])
    .filter(Boolean)
    .map((layer) => computeEntityBounds(layer))
    .filter(Boolean);

  if (!bounds.length) {
    return null;
  }

  const left = Math.min(...bounds.map((box) => box.left));
  const top = Math.min(...bounds.map((box) => box.top));
  const right = Math.max(...bounds.map((box) => box.right));
  const bottom = Math.max(...bounds.map((box) => box.bottom));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function computeEntityBounds(layer) {
  if (!layer) {
    return null;
  }

  const transform = layer.transform || {};
  const dimensions = layer.dimensions || {};
  const width = (typeof dimensions.width === "number" ? dimensions.width : 0) * (typeof transform.scaleX === "number" ? transform.scaleX : 1);
  const height = (typeof dimensions.height === "number" ? dimensions.height : 0) * (typeof transform.scaleY === "number" ? transform.scaleY : 1);
  const x = typeof transform.x === "number" ? transform.x : 0;
  const y = typeof transform.y === "number" ? transform.y : 0;
  const rotation = (typeof transform.rotation === "number" ? transform.rotation : 0) * (Math.PI / 180);

  if (Math.abs(rotation) < LAYER_BOUNDS_EPSILON) {
    return {
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
    };
  }

  const centerX = x + width / 2;
  const centerY = y + height / 2;

  const corners = [
    rotatePointForBounds(-width / 2, -height / 2, rotation),
    rotatePointForBounds(width / 2, -height / 2, rotation),
    rotatePointForBounds(width / 2, height / 2, rotation),
    rotatePointForBounds(-width / 2, height / 2, rotation),
  ];

  const xs = corners.map((corner) => corner.x + centerX);
  const ys = corners.map((corner) => corner.y + centerY);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function rotatePointForBounds(x, y, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

function clampUnit(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }

  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

const defaultLayerState = buildDefaultLayerState();
const defaultSelectionItems = defaultLayerState.order.length ? [defaultLayerState.order[0]] : [];
const defaultSelectionBounds =
  defaultSelectionItems.length > 0
    ? calculateBoundsForLayerIds(defaultLayerState.entities, defaultSelectionItems)
    : null;

const DEFAULT_TOOL_OPTIONS = {
  pointer: { cursor: "default" },
  move: {
    snapToGrid: true,
    snapToGuides: true,
    snapTolerance: 6,
    gridSize: 8,
    angleIncrement: 15,
    scaleIncrement: 0.05,
    showHandles: true,
    selectionMode: "replace",
    constrainProportions: false,
  },
  brush: {
    size: 32,
    hardness: 0.75,
    opacity: 0.9,
    smoothing: 0.25,
    spacing: 0.16,
    flow: 0.9,
    texture: false,
  },
  eraser: {
    size: 48,
    hardness: 0.35,
    opacity: 1,
    smoothing: 0.2,
    spacing: 0.18,
    flow: 1,
    protectTransparency: false,
  },
  text: {
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    fontSize: 48,
    fontWeight: 400,
    align: "left",
    color: "#ffffff",
  },
  crop: {
    showGuides: true,
    constrainAspect: false,
    aspectRatio: null,
  },
};

const defaultState = deepFreeze({
  project: {
    id: null,
    name: "Untitled Project",
    description: "",
    createdAt: null,
    updatedAt: null,
    metadata: {},
  },
  layers: {
    order: defaultLayerState.order,
    entities: defaultLayerState.entities,
    active: defaultLayerState.active,
    stats: defaultLayerState.stats,
  },
  viewport: {
    zoom: 1,
    minZoom: 0.25,
    maxZoom: 4,
    pan: { x: 0, y: 0 },
    rotation: 0,
    size: { width: 1280, height: 720 },
    canvas: { width: 0, height: 0, dpr: 1 },
    grid: DEFAULT_VIEWPORT_GRID,
  },
  tools: {
    active: "pointer",
    options: mergeDeep({}, DEFAULT_TOOL_OPTIONS),
    lastUsed: null,
    cursor: "default",
  },
  selection: {
    items: defaultSelectionItems,
    bounds: defaultSelectionBounds,
    mode: "replace",
  },
  history: {
    pointer: -1,
    size: 0,
    canUndo: false,
    canRedo: false,
    capacity: DEFAULT_HISTORY_CAPACITY,
    version: 0,
    lastCommand: null,
  },
  ui: {
    panels: {
      collapsed: {
        properties: false,
        color: false,
        layers: false,
        adjustments: true,
        activity: true,
      },
    },
    color: {
      model: "hex",
      hex: "#000000",
      opacity: 1,
      swatches: [
        { hex: "#000000", opacity: 1 },
        { hex: "#ffffff", opacity: 1 },
        { hex: "#ff0000", opacity: 1 },
        { hex: "#00ff00", opacity: 1 },
        { hex: "#0000ff", opacity: 1 }
      ],
    },
  },
});

deepFreeze(defaultState.project);
deepFreeze(defaultState.layers);
deepFreeze(defaultState.viewport);
deepFreeze(defaultState.tools);
deepFreeze(defaultState.selection);
deepFreeze(defaultState.history);
if (defaultState.ui) deepFreeze(defaultState.ui);

function createStore(initialState = defaultState, options = {}) {
  const bus = options.eventBus ?? eventBus;
  let state = deepFreeze(cloneValue(initialState));
  let version = 0;

  const subscribers = new Set();

  function notifySubscribers(meta) {
    subscribers.forEach((subscription) => {
      let nextValue;
      try {
        nextValue = subscription.selector(state);
      } catch (error) {
        console.error("Store selector failed", error);
        return;
      }

      const hasChanged = !subscription.equality(nextValue, subscription.lastValue);

      if (!hasChanged) {
        return;
      }

      const previous = subscription.lastValue;
      subscription.lastValue = nextValue;

      try {
        subscription.listener(cloneValue(nextValue), previous === undefined ? undefined : cloneValue(previous), meta);
      } catch (error) {
        console.error("Store subscriber failed", error);
      }
    });
  }

  function setState(nextState, meta = {}) {
    if (!isPlainObject(nextState)) {
      throw new TypeError("Next state must be a plain object");
    }

    const frozenNextState = deepFreeze(nextState);

    if (Object.is(frozenNextState, state)) {
      return state;
    }

    state = frozenNextState;
    version += 1;

    notifySubscribers(meta);

    if (bus) {
      bus.emit("store:change", {
        state: cloneValue(state),
        meta: { ...meta, version },
      });
    }

    return state;
  }

  function dispatch(updater, meta = {}) {
    if (typeof updater === "function") {
      const workingState = cloneValue(state);
      const result = updater(workingState, cloneValue(state));
      const nextState = result !== undefined ? result : workingState;
      return setState(nextState, meta);
    }

    if (isPlainObject(updater)) {
      const workingState = cloneValue(state);
      const nextState = mergeDeep(workingState, updater);
      return setState(nextState, meta);
    }

    throw new TypeError("Dispatch expects a function updater or plain object with changes");
  }

  function updateSlice(sliceKey, updater, meta = {}) {
    if (typeof sliceKey !== "string" || !(sliceKey in state)) {
      throw new ReferenceError(`Unknown state slice: ${sliceKey}`);
    }

    return dispatch((workingState) => {
      const currentSlice = cloneValue(workingState[sliceKey]);
      let nextSlice;

      if (typeof updater === "function") {
        const result = updater(currentSlice, cloneValue(state[sliceKey]));
        nextSlice = result !== undefined ? result : currentSlice;
      } else if (isPlainObject(updater)) {
        nextSlice = mergeDeep(currentSlice, updater);
      } else {
        throw new TypeError("Slice updater must be a function or plain object");
      }

      workingState[sliceKey] = nextSlice;
      return workingState;
    }, meta);
  }

  function replace(nextState, meta = {}) {
    return setState(cloneValue(nextState), meta);
  }

  function reset(meta = {}) {
    return setState(cloneValue(initialState), meta);
  }

  function getState() {
    return state;
  }

  function getSnapshot() {
    return cloneValue(state);
  }

  function select(selector) {
    const resolvedSelector = typeof selector === "function" ? selector : (value) => value;
    return resolvedSelector(state);
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      throw new TypeError("Store subscription listener must be a function");
    }

    const selector = typeof options.selector === "function" ? options.selector : (value) => value;
    const equality = typeof options.equality === "function" ? options.equality : Object.is;

    const subscription = {
      listener,
      selector,
      equality,
      lastValue: selector(state),
    };

    subscribers.add(subscription);

    if (options.fireImmediately) {
      listener(cloneValue(subscription.lastValue), undefined, { immediate: true });
    }

    return () => {
      subscribers.delete(subscription);
    };
  }

  function destroy() {
    subscribers.clear();
  }

  return {
    dispatch,
    updateSlice,
    replace,
    reset,
    getState,
    getSnapshot,
    select,
    subscribe,
    destroy,
    get version() {
      return version;
    },
  };
}

export const store = createStore();
export { defaultState as initialState, cloneValue as cloneStateValue, createStore as createStateStore };
