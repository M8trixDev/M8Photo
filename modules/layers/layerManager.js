import { store, cloneStateValue, calculateBoundsForLayerIds } from "../core/store.js";
import { eventBus } from "../core/events.js";

function normaliseLayerId(value) {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (value && typeof value.id === "string") {
    return value.id.trim();
  }

  return null;
}

function cloneTransform(transform = {}) {
  return {
    x: typeof transform.x === "number" ? transform.x : 0,
    y: typeof transform.y === "number" ? transform.y : 0,
    rotation: typeof transform.rotation === "number" ? transform.rotation : 0,
    scaleX: typeof transform.scaleX === "number" ? transform.scaleX : 1,
    scaleY: typeof transform.scaleY === "number" ? transform.scaleY : 1,
  };
}

function cloneDimensions(dimensions = {}) {
  return {
    width: typeof dimensions.width === "number" ? dimensions.width : 0,
    height: typeof dimensions.height === "number" ? dimensions.height : 0,
  };
}

function buildRenderLayer(layer, stackIndex, orderIndex) {
  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    locked: Boolean(layer.locked),
    visible: layer.visible !== false,
    opacity: typeof layer.opacity === "number" ? layer.opacity : 1,
    blendingMode: layer.blendingMode || "normal",
    transform: cloneTransform(layer.transform),
    dimensions: cloneDimensions(layer.dimensions),
    strokes: Array.isArray(layer.strokes) ? layer.strokes : [],
    metadata: layer.metadata || {},
    createdAt: layer.createdAt ?? null,
    updatedAt: layer.updatedAt ?? null,
    stackIndex,
    orderIndex,
  };
}

function recalculateStats(entities) {
  const ids = Object.keys(entities);
  let visible = 0;

  ids.forEach((id) => {
    const layer = entities[id];
    if (layer && layer.visible !== false && (typeof layer.opacity !== "number" || layer.opacity > 0)) {
      visible += 1;
    }
  });

  return {
    count: ids.length,
    visible,
  };
}

function mergeLayerChanges(layer, changes = {}) {
  const next = { ...layer };

  if (Object.prototype.hasOwnProperty.call(changes, "name") && typeof changes.name === "string") {
    next.name = changes.name;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "locked")) {
    next.locked = Boolean(changes.locked);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "visible")) {
    next.visible = Boolean(changes.visible);
  }

  if (typeof changes.opacity === "number" && !Number.isNaN(changes.opacity)) {
    next.opacity = Math.min(Math.max(changes.opacity, 0), 1);
  }

  if (typeof changes.blendingMode === "string" && changes.blendingMode.trim() !== "") {
    next.blendingMode = changes.blendingMode.trim();
  }

  if (typeof changes.type === "string" && changes.type.trim() !== "") {
    next.type = changes.type.trim();
  }

  if (changes.transform && typeof changes.transform === "object") {
    const current = cloneTransform(layer.transform);
    next.transform = {
      x: typeof changes.transform.x === "number" ? changes.transform.x : current.x,
      y: typeof changes.transform.y === "number" ? changes.transform.y : current.y,
      rotation:
        typeof changes.transform.rotation === "number" ? changes.transform.rotation : current.rotation,
      scaleX: typeof changes.transform.scaleX === "number" ? changes.transform.scaleX : current.scaleX,
      scaleY: typeof changes.transform.scaleY === "number" ? changes.transform.scaleY : current.scaleY,
    };
  }

  if (changes.dimensions && typeof changes.dimensions === "object") {
    const current = cloneDimensions(layer.dimensions);
    next.dimensions = {
      width: typeof changes.dimensions.width === "number" ? changes.dimensions.width : current.width,
      height:
        typeof changes.dimensions.height === "number" ? changes.dimensions.height : current.height,
    };
  }

  if (Object.prototype.hasOwnProperty.call(changes, "strokes") && Array.isArray(changes.strokes)) {
    next.strokes = changes.strokes.map((stroke) => ({ ...stroke }));
  }

  if (changes.metadata && typeof changes.metadata === "object") {
    next.metadata = { ...layer.metadata, ...changes.metadata };
  }

  next.updatedAt = Date.now();

  return next;
}

export function createLayerManager(options = {}) {
  const storeRef = options.store ?? store;
  const bus = options.eventBus ?? eventBus;

  function getState() {
    return storeRef.getState();
  }

  function getLayersState(state = getState()) {
    return state.layers || { order: [], entities: {}, stats: { count: 0, visible: 0 }, active: null };
  }

  function listLayers(options = {}) {
    const state = options.state || getState();
    const layersState = getLayersState(state);
    const order = Array.isArray(layersState.order) ? layersState.order.slice() : [];
    const entities = layersState.entities || {};
    const iterate = options.bottomFirst ? order.slice().reverse() : order;

    return iterate
      .map((id, index) => {
        const layer = entities[id];
        if (!layer) {
          return null;
        }
        const stackIndex = options.bottomFirst ? index : iterate.length - index - 1;
        const orderIndex = options.bottomFirst ? iterate.length - index - 1 : index;
        return buildRenderLayer(layer, stackIndex, orderIndex);
      })
      .filter(Boolean);
  }

  function getRenderableLayers(options = {}) {
    const layers = listLayers(options);
    if (options.excludeHidden) {
      return layers.filter((layer) => layer.visible && layer.opacity > 0);
    }
    return layers;
  }

  function getLayer(layerId) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    const layersState = getLayersState();
    const layer = layersState.entities?.[id];
    if (!layer) {
      return null;
    }
    const orderIndex = layersState.order.indexOf(id);
    const stackIndex = orderIndex >= 0 ? layersState.order.length - orderIndex - 1 : 0;
    return buildRenderLayer(layer, stackIndex, orderIndex);
  }

  function getActiveLayer() {
    const state = getLayersState();
    return getLayer(state.active);
  }

  function setActiveLayer(layerId, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    const state = getLayersState();
    if (!state.entities?.[id]) {
      return null;
    }

    const result = storeRef.updateSlice(
      "layers",
      (layers) => {
        if (layers.active === id) {
          return layers;
        }
        return { ...layers, active: id };
      },
      { reason: "layers:set-active", layerId: id, source: meta.source || "layer-manager" }
    );

    if (meta.updateSelection !== false) {
      const snapshot = storeRef.getState();
      const entities = snapshot.layers?.entities || {};
      const bounds = calculateBoundsForLayerIds(entities, [id]);

      storeRef.updateSlice(
        "selection",
        (selection) => ({
          ...selection,
          items: [id],
          bounds: bounds ? cloneStateValue(bounds) : null,
          mode: "replace",
        }),
        { reason: "layers:set-active", layerId: id, source: meta.source || "layer-manager" }
      );
    }

    if (bus) {
      bus.emit("layers:active", {
        layerId: id,
        source: meta.source || "layer-manager",
      });
    }

    return result;
  }

  function toggleVisibility(layerId, forceVisible, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    let nextVisibility = null;

    const result = storeRef.updateSlice(
      "layers",
      (layers) => {
        const layer = layers.entities?.[id];
        if (!layer) {
          return layers;
        }

        const targetVisible =
          typeof forceVisible === "boolean" ? forceVisible : layer.visible === false;

        if ((layer.visible !== false) === targetVisible) {
          return layers;
        }

        const entities = { ...layers.entities, [id]: { ...layer, visible: targetVisible, updatedAt: Date.now() } };
        const stats = recalculateStats(entities);
        nextVisibility = targetVisible;

        return {
          ...layers,
          entities,
          stats,
        };
      },
      { reason: "layers:toggle-visibility", layerId: id, source: meta.source || "layer-manager" }
    );

    if (nextVisibility === null) {
      return result;
    }

    if (bus) {
      bus.emit("layers:visibility", {
        layerId: id,
        visible: nextVisibility,
        source: meta.source || "layer-manager",
      });
    }

    return result;
  }

  function updateLayer(layerId, changes = {}, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id || !changes || typeof changes !== "object") {
      return null;
    }

    let mergedLayer = null;

    const result = storeRef.updateSlice(
      "layers",
      (layers) => {
        const layer = layers.entities?.[id];
        if (!layer) {
          return layers;
        }

        mergedLayer = mergeLayerChanges(layer, changes);

        if (Object.is(mergedLayer, layer)) {
          return layers;
        }

        const entities = { ...layers.entities, [id]: mergedLayer };
        const stats = recalculateStats(entities);

        return {
          ...layers,
          entities,
          stats,
        };
      },
      { reason: "layers:update", layerId: id, source: meta.source || "layer-manager" }
    );

    if (mergedLayer && bus) {
      bus.emit("layers:update", {
        layerId: id,
        changes: cloneStateValue(changes),
        layer: mergedLayer,
        source: meta.source || "layer-manager",
      });
    }

    return result;
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      throw new TypeError("Layer manager subscription listener must be a function");
    }

    return storeRef.subscribe(
      (layersState) => {
        listener(cloneStateValue(layersState));
      },
      {
        selector: (state) => state.layers,
        equality: options.equality || Object.is,
        fireImmediately: options.fireImmediately !== false,
      }
    );
  }

  return {
    listLayers,
    getRenderableLayers,
    getLayer,
    getActiveLayer,
    setActiveLayer,
    toggleVisibility,
    updateLayer,
    subscribe,
  };
}

export const layerManager = createLayerManager();
