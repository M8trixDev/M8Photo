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

let layerSequence = 0;

function generateLayerId(prefix = "layer") {
  layerSequence += 1;
  const timestamp = Date.now().toString(36);
  const counter = layerSequence.toString(36);
  return `${prefix}-${timestamp}-${counter}`;
}

function clampUnit(value, fallback = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function normaliseLayerName(name, fallback = "Layer") {
  if (typeof name === "string") {
    const trimmed = name.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }
  return fallback;
}

function copyStrokes(strokes) {
  if (!Array.isArray(strokes)) {
    return [];
  }
  return cloneStateValue(strokes);
}

function copyMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return cloneStateValue(metadata);
}

function collectLayerNames(entities = {}, skipId) {
  const names = new Set();
  Object.keys(entities).forEach((id) => {
    if (skipId && id === skipId) {
      return;
    }
    const candidate = entities[id]?.name;
    if (typeof candidate === "string" && candidate.trim() !== "") {
      names.add(candidate.trim());
    }
  });
  return names;
}

function dedupeLayerName(name, entities, skipId) {
  const base = normaliseLayerName(name);
  const names = collectLayerNames(entities, skipId);

  if (!names.has(base)) {
    return base;
  }

  let index = 2;
  let candidate = `${base} ${index}`;
  while (names.has(candidate)) {
    index += 1;
    candidate = `${base} ${index}`;
  }

  return candidate;
}

function generateDuplicateLayerName(sourceName, entities) {
  const base = normaliseLayerName(sourceName || "Layer");
  const template = `${base} Copy`;
  return dedupeLayerName(template, entities);
}

function createLayerEntity(definition = {}, context = {}) {
  const entities = context.entities || {};
  const prefix = context.idPrefix || "layer";
  const now = Date.now();
  const providedId = normaliseLayerId(definition.id);
  let id = providedId;

  if (!id || entities[id]) {
    do {
      id = generateLayerId(prefix);
    } while (entities[id]);
  }

  const nameCandidate =
    typeof definition.name === "string" && definition.name.trim() !== ""
      ? definition.name
      : context.fallbackName || "Layer";

  const name =
    context.uniqueName === false
      ? normaliseLayerName(nameCandidate)
      : dedupeLayerName(nameCandidate, entities, id);

  return {
    id,
    name,
    type:
      typeof definition.type === "string" && definition.type.trim() !== ""
        ? definition.type.trim()
        : "raster",
    locked: Boolean(definition.locked),
    visible: definition.visible !== false,
    opacity: clampUnit(
      typeof definition.opacity === "number" && !Number.isNaN(definition.opacity)
        ? definition.opacity
        : 1
    ),
    blendingMode:
      typeof definition.blendingMode === "string" && definition.blendingMode.trim() !== ""
        ? definition.blendingMode.trim()
        : "normal",
    transform: cloneTransform(definition.transform),
    dimensions: cloneDimensions(definition.dimensions),
    strokes: copyStrokes(definition.strokes),
    metadata: copyMetadata(definition.metadata),
    createdAt: definition.createdAt ?? now,
    updatedAt: definition.updatedAt ?? now,
  };
}

function serialiseLayerEntity(layer) {
  if (!layer) {
    return null;
  }

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
    strokes: copyStrokes(layer.strokes),
    metadata: copyMetadata(layer.metadata),
    createdAt: layer.createdAt ?? null,
    updatedAt: layer.updatedAt ?? null,
  };
}

function resolveInsertionIndex(order, options = {}) {
  const sequence = Array.isArray(order) ? order : [];
  const size = sequence.length;

  if (!options || typeof options !== "object") {
    return 0;
  }

  if (typeof options.index === "number" && !Number.isNaN(options.index)) {
    const nextIndex = Math.floor(options.index);
    if (nextIndex < 0) {
      return 0;
    }
    if (nextIndex > size) {
      return size;
    }
    return nextIndex;
  }

  if (options.before) {
    const beforeId = normaliseLayerId(options.before);
    if (beforeId) {
      const beforeIndex = sequence.indexOf(beforeId);
      if (beforeIndex >= 0) {
        return beforeIndex;
      }
    }
  }

  if (options.after) {
    const afterId = normaliseLayerId(options.after);
    if (afterId) {
      const afterIndex = sequence.indexOf(afterId);
      if (afterIndex >= 0) {
        return afterIndex + 1;
      }
    }
  }

  if (options.position === "bottom") {
    return size;
  }

  if (options.position === "top") {
    return 0;
  }

  return 0;
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

  function createLayer(definition = {}, meta = {}) {
    let createdId = null;

    storeRef.updateSlice(
      "layers",
      (layers) => {
        const entities = layers.entities ? { ...layers.entities } : {};
        const order = Array.isArray(layers.order) ? layers.order.slice() : [];

        const entity = createLayerEntity(
          definition && typeof definition === "object" ? definition : {},
          {
            entities,
            idPrefix: meta.idPrefix || "layer",
            fallbackName: meta.fallbackName,
            uniqueName: meta.uniqueName !== false,
          }
        );

        const insertIndex = resolveInsertionIndex(order, {
          index: meta.index,
          before: meta.before,
          after: meta.after,
          position: meta.position,
        });

        const clampedIndex = Math.max(0, Math.min(order.length, insertIndex));
        order.splice(clampedIndex, 0, entity.id);
        entities[entity.id] = entity;

        const stats = recalculateStats(entities);

        createdId = entity.id;

        const nextLayers = {
          ...layers,
          order,
          entities,
          stats,
        };

        if (meta.setActive !== false) {
          nextLayers.active = entity.id;
        }

        return nextLayers;
      },
      { reason: "layers:create", source: meta.source || "layer-manager" }
    );

    if (!createdId) {
      return null;
    }

    const stateAfter = storeRef.getState();
    const layerEntities = stateAfter.layers?.entities || {};
    const entitySnapshot = serialiseLayerEntity(layerEntities[createdId]);
    const renderLayer = getLayer(createdId);

    if (meta.setActive !== false) {
      setActiveLayer(createdId, {
        source: meta.source || "layer-manager",
        updateSelection: meta.updateSelection !== false,
      });
    }

    if (bus) {
      bus.emit("layers:create", {
        layerId: createdId,
        layer: cloneStateValue(entitySnapshot),
        renderLayer,
        source: meta.source || "layer-manager",
      });
    }

    return renderLayer;
  }

  function removeLayer(layerId, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    let removedSnapshot = null;

    storeRef.updateSlice(
      "layers",
      (layers) => {
        const entities = layers.entities || {};
        const layer = entities[id];
        if (!layer) {
          return layers;
        }

        const order = Array.isArray(layers.order) ? layers.order.slice() : [];
        const orderIndex = order.indexOf(id);
        if (orderIndex === -1) {
          return layers;
        }

        const stackIndex = order.length - orderIndex - 1;
        removedSnapshot = {
          entity: serialiseLayerEntity(layer),
          orderIndex,
          stackIndex,
        };

        const nextOrder = order.filter((value) => value !== id);
        const nextEntities = { ...entities };
        delete nextEntities[id];

        const stats = recalculateStats(nextEntities);
        let nextActive = layers.active;

        if (nextActive === id) {
          if (nextOrder.length) {
            const fallbackIndex = Math.min(orderIndex, nextOrder.length - 1);
            nextActive = nextOrder[fallbackIndex] || null;
          } else {
            nextActive = null;
          }
        }

        return {
          ...layers,
          order: nextOrder,
          entities: nextEntities,
          stats,
          active: nextActive,
        };
      },
      { reason: "layers:remove", source: meta.source || "layer-manager" }
    );

    if (!removedSnapshot) {
      return null;
    }

    const stateAfter = storeRef.getState();
    const layersState = stateAfter.layers || {};
    const entities = layersState.entities || {};
    const selectionState = stateAfter.selection || {};
    const selectionItems = Array.isArray(selectionState.items) ? selectionState.items : [];
    const wasSelected = selectionItems.includes(id);
    const shouldUpdateSelection = meta.updateSelection !== false || wasSelected;

    if (shouldUpdateSelection) {
      storeRef.updateSlice(
        "selection",
        (selection) => {
          const existing = Array.isArray(selection.items) ? selection.items.filter((item) => item !== id) : [];
          let nextItems = existing;

          if (meta.updateSelection !== false) {
            const activeId = layersState.active;
            if (activeId) {
              nextItems = [activeId, ...existing.filter((item) => item !== activeId)];
            }
          }

          const uniqueItems = Array.from(new Set(nextItems));
          const bounds =
            uniqueItems.length > 0
              ? calculateBoundsForLayerIds(entities, uniqueItems)
              : null;

          return {
            ...selection,
            items: uniqueItems,
            bounds: bounds ? cloneStateValue(bounds) : null,
            mode: meta.updateSelection !== false ? "replace" : selection.mode ?? "replace",
          };
        },
        { reason: "layers:remove-selection", layerId: id, source: meta.source || "layer-manager" }
      );
    }

    if (bus) {
      const renderLayer = buildRenderLayer(
        { ...removedSnapshot.entity },
        removedSnapshot.stackIndex,
        removedSnapshot.orderIndex
      );
      bus.emit("layers:remove", {
        layerId: id,
        layer: cloneStateValue(removedSnapshot.entity),
        renderLayer,
        source: meta.source || "layer-manager",
      });
    }

    return removedSnapshot;
  }

  function removeLayers(layerIds, meta = {}) {
    const ids = Array.isArray(layerIds) ? layerIds : [layerIds];
    const normalised = Array.from(new Set(ids.map((value) => normaliseLayerId(value)).filter(Boolean)));
    if (!normalised.length) {
      return [];
    }

    const removed = [];

    normalised.forEach((candidate, index) => {
      const result = removeLayer(candidate, {
        ...meta,
        updateSelection: index === normalised.length - 1 ? meta.updateSelection : false,
      });
      if (result) {
        removed.push(result);
      }
    });

    return removed;
  }

  function duplicateLayer(layerId, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    const layersState = getLayersState();
    const source = layersState.entities?.[id];
    if (!source) {
      return null;
    }

    const definition = serialiseLayerEntity(source);
    definition.id = meta.reuseId === true ? definition.id : null;

    const desiredName =
      typeof meta.name === "string" && meta.name.trim() !== ""
        ? meta.name.trim()
        : generateDuplicateLayerName(definition.name, layersState.entities);

    definition.name = desiredName;
    definition.createdAt = Date.now();
    definition.updatedAt = Date.now();

    const transform = cloneTransform(definition.transform);
    if (meta.offset && typeof meta.offset === "object") {
      if (typeof meta.offset.x === "number") {
        transform.x += meta.offset.x;
      }
      if (typeof meta.offset.y === "number") {
        transform.y += meta.offset.y;
      }
    }
    definition.transform = transform;

    if (typeof meta.locked === "boolean") {
      definition.locked = meta.locked;
    }

    if (typeof meta.visible === "boolean") {
      definition.visible = meta.visible;
    }

    const orderIndex = layersState.order.indexOf(id);

    return createLayer(definition, {
      source: meta.source || "layer-manager",
      index: orderIndex >= 0 ? orderIndex : undefined,
      setActive: meta.setActive !== false,
      updateSelection: meta.updateSelection !== false,
      uniqueName: false,
    });
  }

  function renameLayer(layerId, nextName, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    const layersState = getLayersState();
    const layer = layersState.entities?.[id];
    if (!layer) {
      return null;
    }

    const proposed = normaliseLayerName(nextName, layer.name || "Layer");
    const unique = dedupeLayerName(proposed, layersState.entities, id);

    if (unique === layer.name) {
      return getLayer(id);
    }

    return updateLayer(id, { name: unique }, meta);
  }

  function toggleVisibility(layerId, forceVisible, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    let changed = false;

    storeRef.updateSlice(
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

        const updatedLayer = {
          ...layer,
          visible: targetVisible,
          updatedAt: Date.now(),
        };

        const entities = { ...layers.entities, [id]: updatedLayer };
        const stats = recalculateStats(entities);
        changed = true;

        return {
          ...layers,
          entities,
          stats,
        };
      },
      { reason: "layers:toggle-visibility", layerId: id, source: meta.source || "layer-manager" }
    );

    if (!changed) {
      return null;
    }

    const renderLayer = getLayer(id);

    if (bus) {
      bus.emit("layers:visibility", {
        layerId: id,
        visible: renderLayer ? renderLayer.visible !== false : undefined,
        renderLayer,
        source: meta.source || "layer-manager",
      });
    }

    return renderLayer;
  }

  function toggleLock(layerId, forceLocked, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id) {
      return null;
    }

    let changed = false;

    storeRef.updateSlice(
      "layers",
      (layers) => {
        const layer = layers.entities?.[id];
        if (!layer) {
          return layers;
        }

        const targetLocked = typeof forceLocked === "boolean" ? forceLocked : !layer.locked;

        if (Boolean(layer.locked) === targetLocked) {
          return layers;
        }

        const updatedLayer = {
          ...layer,
          locked: targetLocked,
          updatedAt: Date.now(),
        };

        const entities = { ...layers.entities, [id]: updatedLayer };
        changed = true;

        return {
          ...layers,
          entities,
        };
      },
      { reason: "layers:toggle-lock", layerId: id, source: meta.source || "layer-manager" }
    );

    if (!changed) {
      return null;
    }

    const renderLayer = getLayer(id);

    if (bus) {
      bus.emit("layers:lock", {
        layerId: id,
        locked: renderLayer ? Boolean(renderLayer.locked) : undefined,
        renderLayer,
        source: meta.source || "layer-manager",
      });
    }

    return renderLayer;
  }

  function updateLayer(layerId, changes = {}, meta = {}) {
    const id = normaliseLayerId(layerId);
    if (!id || !changes || typeof changes !== "object") {
      return null;
    }

    let mergedLayer = null;

    storeRef.updateSlice(
      "layers",
      (layers) => {
        const layer = layers.entities?.[id];
        if (!layer) {
          return layers;
        }

        mergedLayer = mergeLayerChanges(layer, changes);

        if (Object.is(mergedLayer, layer)) {
          mergedLayer = null;
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

    if (!mergedLayer) {
      return null;
    }

    const renderLayer = getLayer(id);

    if (bus) {
      bus.emit("layers:update", {
        layerId: id,
        changes: cloneStateValue(changes),
        layer: serialiseLayerEntity(mergedLayer),
        renderLayer,
        source: meta.source || "layer-manager",
      });
    }

    return renderLayer;
  }

  function reorderLayers(layerIds, target = {}, meta = {}) {
    const ids = Array.isArray(layerIds) ? layerIds : [layerIds];
    const normalised = Array.from(new Set(ids.map((value) => normaliseLayerId(value)).filter(Boolean)));
    if (!normalised.length) {
      return null;
    }

    let result = null;

    storeRef.updateSlice(
      "layers",
      (layers) => {
        const order = Array.isArray(layers.order) ? layers.order.slice() : [];
        if (!order.length) {
          return layers;
        }

        const present = normalised.filter((id) => order.includes(id));
        if (!present.length) {
          return layers;
        }

        const originalOrder = order.slice();
        present.sort((a, b) => originalOrder.indexOf(a) - originalOrder.indexOf(b));

        const reducedOrder = originalOrder.filter((id) => !present.includes(id));

        const insertionTarget = {
          index: target.index,
          before: target.before,
          after: target.after,
          position: target.position,
        };

        let insertIndex = resolveInsertionIndex(reducedOrder, insertionTarget);
        if (insertIndex < 0) {
          insertIndex = 0;
        }
        if (insertIndex > reducedOrder.length) {
          insertIndex = reducedOrder.length;
        }

        reducedOrder.splice(insertIndex, 0, ...present);

        const changed =
          reducedOrder.length !== originalOrder.length ||
          reducedOrder.some((value, index) => value !== originalOrder[index]);

        if (!changed) {
          return layers;
        }

        result = {
          layerIds: present.slice(),
          order: reducedOrder.slice(),
          index: insertIndex,
        };

        return {
          ...layers,
          order: reducedOrder,
        };
      },
      { reason: "layers:reorder", layerIds: normalised, source: meta.source || "layer-manager" }
    );

    if (!result) {
      return null;
    }

    if (bus) {
      bus.emit("layers:reorder", {
        layerIds: result.layerIds.slice(),
        order: result.order.slice(),
        index: result.index,
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
    createLayer,
    removeLayer,
    removeLayers,
    duplicateLayer,
    renameLayer,
    toggleVisibility,
    toggleLock,
    updateLayer,
    reorderLayers,
    subscribe,
  };
}

export const layerManager = createLayerManager();
