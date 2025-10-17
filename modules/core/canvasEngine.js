import { deriveViewportState } from "./viewportState.js";

const DEFAULT_LAYER_TRANSFORM = {
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  originX: null,
  originY: null,
};

function resetTransform(ctx) {
  if (typeof ctx.resetTransform === "function") {
    ctx.resetTransform();
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function prepareLayerTransform(transform = {}) {
  return {
    ...DEFAULT_LAYER_TRANSFORM,
    ...transform,
  };
}

function detectBlendModeSupport(ctx) {
  const modes = new Set(["source-over"]);
  if (!ctx) {
    return modes;
  }

  const testModes = [
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
  ];

  const original = ctx.globalCompositeOperation;

  for (const mode of testModes) {
    try {
      ctx.globalCompositeOperation = mode;
      if (ctx.globalCompositeOperation === mode) {
        modes.add(mode);
      }
    } catch (error) {
      // Ignore unsupported modes.
    }
  }

  ctx.globalCompositeOperation = original;
  return modes;
}

export class CanvasEngine {
  constructor(canvas, options = {}) {
    if (!canvas) {
      throw new Error("CanvasEngine requires a canvas element.");
    }

    this.canvas = canvas;
    this.context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });

    if (!this.context) {
      throw new Error("Canvas context could not be created.");
    }

    this.supportedBlendModes = detectBlendModeSupport(this.context);

    const {
      eventBus = null,
      store = null,
      viewport = null,
      pixelRatio = typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1,
      container = canvas.parentElement,
    } = options;

    this.eventBus = eventBus;
    this.store = store;
    this.viewport = viewport;
    this.pixelRatio = pixelRatio;
    this.container = container || canvas;

    this.layers = new Map();
    this.layerOrder = [];
    this.running = false;
    this.frameHandle = null;
    this.lastTimestamp = 0;
    this.logicalSize = {
      width: canvas.clientWidth || canvas.width,
      height: canvas.clientHeight || canvas.height,
    };

    this.eventBusSubscriptions = [];

    const initialStoreState = typeof store?.getState === "function" ? store.getState() : {};
    this.viewportState = deriveViewportState(initialStoreState.viewport);

    if (!initialStoreState.viewport && typeof store?.setState === "function") {
      store.setState({ viewport: this.viewportState }, { silent: true });
    }

    this.handleStoreChange = this.handleStoreChange.bind(this);
    this.renderFrame = this.renderFrame.bind(this);
    this.handleResize = this.handleResize.bind(this);

    if (typeof store?.subscribe === "function") {
      this.unsubscribeStore = store.subscribe(this.handleStoreChange);
    }

    if (this.eventBus) {
      this.eventBusSubscriptions.push(
        this.eventBus.on("viewport:changed", (viewportState) => {
          if (!viewportState) {
            return;
          }
          this.viewportState = deriveViewportState({
            ...this.viewportState,
            ...viewportState,
          });
          this.requestRender();
        }),
      );

      this.eventBusSubscriptions.push(
        this.eventBus.on("render:request", () => this.requestRender()),
      );
    }

    this.configureResizeHandling();
    this.handleResize();
    this.start();
  }

  configureResizeHandling() {
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        const { width, height } = entry.contentRect;
        this.syncCanvasDimensions(width, height);
      });
      this.resizeObserver.observe(this.container);
    } else if (typeof window !== "undefined") {
      window.addEventListener("resize", this.handleResize, { passive: true });
    }
  }

  handleResize() {
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || this.canvas.width / this.pixelRatio || 1;
    const height = rect.height || this.canvas.height / this.pixelRatio || 1;
    this.syncCanvasDimensions(width, height);
  }

  syncCanvasDimensions(width, height) {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));

    this.logicalSize = { width: safeWidth, height: safeHeight };

    const physicalWidth = Math.max(1, Math.round(safeWidth * this.pixelRatio));
    const physicalHeight = Math.max(1, Math.round(safeHeight * this.pixelRatio));

    if (this.canvas.width !== physicalWidth) {
      this.canvas.width = physicalWidth;
    }

    if (this.canvas.height !== physicalHeight) {
      this.canvas.height = physicalHeight;
    }

    this.canvas.style.width = `${safeWidth}px`;
    this.canvas.style.height = `${safeHeight}px`;

    resetTransform(this.context);
    this.context.scale(this.pixelRatio, this.pixelRatio);

    this.layers.forEach((layer) => {
      const { buffer } = layer;
      buffer.width = physicalWidth;
      buffer.height = physicalHeight;
      layer.needsRedraw = true;
    });

    const viewportPatch = {
      viewport: {
        viewportSize: { width: safeWidth, height: safeHeight },
        rotationOrigin: {
          x: safeWidth / 2,
          y: safeHeight / 2,
        },
      },
    };

    this.viewportState = deriveViewportState({
      ...this.viewportState,
      ...viewportPatch.viewport,
    });

    if (typeof this.store?.setState === "function") {
      this.store.setState(viewportPatch);
    }

    if (this.eventBus) {
      this.eventBus.emit("viewport:changed", this.viewportState);
      this.eventBus.emit("viewport:resized", {
        size: { ...this.logicalSize },
        pixelRatio: this.pixelRatio,
      });
    }

    this.requestRender();
  }

  handleStoreChange(state) {
    if (!state?.viewport) {
      return;
    }

    this.viewportState = deriveViewportState(state.viewport);
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.frameHandle = requestAnimationFrame(this.renderFrame);
  }

  stop() {
    this.running = false;
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  destroy() {
    this.stop();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    } else if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleResize, { passive: true });
    }

    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }

    if (this.eventBusSubscriptions) {
      this.eventBusSubscriptions.forEach((off) => {
        if (typeof off === "function") {
          off();
        }
      });
      this.eventBusSubscriptions = [];
    }

    this.layers.clear();
    this.layerOrder.length = 0;
  }

  requestRender() {
    this.needsRender = true;
  }

  registerLayer(layerConfig) {
    const {
      id,
      render,
      blendMode = "source-over",
      opacity = 1,
      visible = true,
      transform,
      dynamic = false,
      metadata = {},
    } = layerConfig;

    if (!id) {
      throw new Error("Layers must have a stable identifier.");
    }

    if (this.layers.has(id)) {
      throw new Error(`Layer with id "${id}" has already been registered.`);
    }

    const buffer = document.createElement("canvas");
    buffer.width = Math.max(1, Math.round(this.logicalSize.width * this.pixelRatio));
    buffer.height = Math.max(1, Math.round(this.logicalSize.height * this.pixelRatio));
    const bufferContext = buffer.getContext("2d", { alpha: true });

    const layer = {
      id,
      render,
      blendMode,
      opacity: clamp(opacity, 0, 1),
      visible,
      transform: prepareLayerTransform(transform),
      buffer,
      context: bufferContext,
      needsRedraw: true,
      dynamic,
      metadata,
    };

    this.layers.set(id, layer);
    this.layerOrder.push(id);

    this.requestRender();
    return layer;
  }

  updateLayer(id, patch) {
    const layer = this.layers.get(id);
    if (!layer) {
      return;
    }

    if (patch.opacity !== undefined) {
      layer.opacity = clamp(patch.opacity, 0, 1);
    }

    if (patch.blendMode) {
      layer.blendMode = patch.blendMode;
    }

    if (patch.visible !== undefined) {
      layer.visible = Boolean(patch.visible);
    }

    if (patch.dynamic !== undefined) {
      layer.dynamic = Boolean(patch.dynamic);
    }

    if (patch.metadata) {
      layer.metadata = { ...layer.metadata, ...patch.metadata };
    }

    if (typeof patch.render === "function") {
      layer.render = patch.render;
    }

    if (patch.transform) {
      this.updateLayerTransform(id, patch.transform);
    }

    layer.needsRedraw = true;
    this.requestRender();
  }

  updateLayerTransform(id, transformPatch) {
    const layer = this.layers.get(id);
    if (!layer) {
      return;
    }

    layer.transform = {
      ...layer.transform,
      ...transformPatch,
    };

    this.requestRender();
  }

  removeLayer(id) {
    if (!this.layers.has(id)) {
      return;
    }

    this.layers.delete(id);
    this.layerOrder = this.layerOrder.filter((layerId) => layerId !== id);
    this.requestRender();
  }

  renderFrame(timestamp) {
    if (!this.running) {
      return;
    }

    this.frameHandle = requestAnimationFrame(this.renderFrame);

    if (!this.context) {
      return;
    }

    if (!this.needsRender && !this.anyDynamicLayers()) {
      return;
    }

    this.needsRender = false;
    this.lastTimestamp = timestamp;

    resetTransform(this.context);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.context.save();
    this.context.scale(this.pixelRatio, this.pixelRatio);

    this.context.save();
    this.applyViewportTransform(this.context);
    this.compositeLayers(this.context, timestamp);
    this.context.restore();

    if (this.viewport?.renderGrid) {
      this.context.save();
      this.applyViewportTransform(this.context);
      this.viewport.renderGrid(this.context, this.logicalSize, this.viewportState);
      this.context.restore();
    }

    this.context.restore();
  }

  anyDynamicLayers() {
    for (const id of this.layerOrder) {
      const layer = this.layers.get(id);
      if (layer?.dynamic) {
        return true;
      }
    }
    return false;
  }

  compositeLayers(ctx, timestamp) {
    for (const layerId of this.layerOrder) {
      const layer = this.layers.get(layerId);
      if (!layer || !layer.visible) {
        continue;
      }

      if (layer.dynamic || layer.needsRedraw) {
        this.renderLayerContents(layer, timestamp);
      }

      ctx.save();

      this.applyLayerTransform(ctx, layer.transform);

      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = this.resolveBlendMode(layer.blendMode);
      ctx.drawImage(
        layer.buffer,
        0,
        0,
        this.logicalSize.width,
        this.logicalSize.height,
      );

      ctx.restore();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  renderLayerContents(layer, timestamp) {
    const ctx = layer.context;

    if (!ctx) {
      return;
    }

    resetTransform(ctx);
    ctx.clearRect(0, 0, layer.buffer.width, layer.buffer.height);
    ctx.scale(this.pixelRatio, this.pixelRatio);

    if (typeof layer.render === "function") {
      layer.render(ctx, {
        size: this.logicalSize,
        pixelRatio: this.pixelRatio,
        timestamp,
        viewport: this.viewportState,
        metadata: layer.metadata,
      });
    }

    layer.needsRedraw = false;
  }

  applyViewportTransform(ctx) {
    const state = this.viewportState;
    const { translation, scale, rotation, rotationOrigin } = state;

    ctx.translate(translation.x, translation.y);

    if (rotation) {
      const originX = rotationOrigin?.x ?? this.logicalSize.width / 2;
      const originY = rotationOrigin?.y ?? this.logicalSize.height / 2;
      ctx.translate(originX, originY);
      ctx.rotate(degToRad(rotation));
      ctx.translate(-originX, -originY);
    }

    ctx.scale(scale, scale);
  }

  applyLayerTransform(ctx, transform) {
    const {
      translateX,
      translateY,
      scaleX,
      scaleY,
      rotation,
      originX,
      originY,
    } = prepareLayerTransform(transform);

    ctx.translate(translateX, translateY);

    const pivotX = originX ?? 0;
    const pivotY = originY ?? 0;

    if (rotation) {
      ctx.translate(pivotX, pivotY);
      ctx.rotate(degToRad(rotation));
      ctx.translate(-pivotX, -pivotY);
    }

    ctx.scale(scaleX, scaleY);
  }

  resolveBlendMode(mode) {
    if (!mode || !this.supportedBlendModes) {
      return "source-over";
    }

    return this.supportedBlendModes.has(mode) ? mode : "source-over";
  }
}
