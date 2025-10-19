import { store } from "./store.js";
import { eventBus } from "./events.js";
import { createLayerManager } from "../layers/layerManager.js";
import { resolveBlendMode } from "../layers/blendModes.js";
import { getCanvas as getAssetCanvas } from "../io/assetStore.js";

const DEFAULT_CANVAS_OPTIONS = Object.freeze({
  backgroundColor: "#0f121a",
  checkerSize: 24,
  checkerLight: "rgba(255, 255, 255, 0.04)",
  checkerDark: "rgba(12, 16, 24, 0.24)",
  selectionPrimary: "rgba(96, 178, 255, 0.85)",
  selectionSecondary: "rgba(255, 255, 255, 0.85)",
});

function clampZoom(value, minZoom, maxZoom) {
  const min = typeof minZoom === "number" && !Number.isNaN(minZoom) ? Math.max(minZoom, 0.05) : 0.05;
  const max = typeof maxZoom === "number" && !Number.isNaN(maxZoom) ? Math.max(maxZoom, min) : 8;
  const target = typeof value === "number" && !Number.isNaN(value) ? value : 1;
  return Math.min(Math.max(target, min), max);
}

function normaliseLayerOpacity(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normaliseTransform(transform = {}) {
  return {
    x: typeof transform.x === "number" ? transform.x : 0,
    y: typeof transform.y === "number" ? transform.y : 0,
    rotation: typeof transform.rotation === "number" ? transform.rotation : 0,
    scaleX: typeof transform.scaleX === "number" && !Number.isNaN(transform.scaleX) ? transform.scaleX : 1,
    scaleY: typeof transform.scaleY === "number" && !Number.isNaN(transform.scaleY) ? transform.scaleY : 1,
  };
}

function createPatternCache() {
  let cache = null;
  let cacheKey = null;

  return function getPattern(context, options, dpr) {
    const key = `${options.checkerSize}|${options.checkerLight}|${options.checkerDark}|${dpr}`;
    if (cache && cacheKey === key) {
      return cache;
    }

    const patternCanvas = document.createElement("canvas");
    const size = Math.max(2, options.checkerSize) * dpr;
    patternCanvas.width = size * 2;
    patternCanvas.height = size * 2;
    const patternCtx = patternCanvas.getContext("2d");

    patternCtx.fillStyle = options.checkerLight;
    patternCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

    patternCtx.fillStyle = options.checkerDark;
    patternCtx.fillRect(0, 0, size, size);
    patternCtx.fillRect(size, size, size, size);

    cache = context.createPattern(patternCanvas, "repeat");
    cacheKey = key;
    return cache;
  };
}

const getCheckerPattern = createPatternCache();

function hashStringToHue(input) {
  const value = String(input ?? "layer");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

function createLayerGradient(context, layer, width, height) {
  const hue = (hashStringToHue(layer.id || layer.name) + layer.stackIndex * 11) % 360;
  const gradient = context.createLinearGradient(0, 0, width, height);

  if (layer.type === "adjustment") {
    gradient.addColorStop(0, `hsla(${hue}, 88%, 68%, 0.55)`);
    gradient.addColorStop(0.5, `hsla(${(hue + 48) % 360}, 82%, 50%, 0.35)`);
    gradient.addColorStop(1, `hsla(${(hue + 120) % 360}, 74%, 42%, 0.3)`);
  } else if (layer.type === "effect") {
    gradient.addColorStop(0, `hsla(${(hue + 220) % 360}, 58%, 62%, 0.5)`);
    gradient.addColorStop(1, `hsla(${(hue + 184) % 360}, 72%, 36%, 0.45)`);
  } else {
    gradient.addColorStop(0, `hsla(${hue}, 72%, 68%, 0.92)`);
    gradient.addColorStop(1, `hsla(${(hue + 24) % 360}, 66%, 42%, 0.9)`);
  }

  return gradient;
}

function drawLayerContent(context, layer, metrics) {
  const width = layer.dimensions?.width ?? 0;
  const height = layer.dimensions?.height ?? 0;

  if (width <= 0 || height <= 0) {
    return;
  }

  // Text layers render text content instead of gradient/image
  if (layer.type === "text" || typeof layer?.metadata?.text === "string") {
    const meta = layer.metadata || {};
    const fontFamily = meta.fontFamily || "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
    const fontSize = typeof meta.fontSize === "number" ? meta.fontSize : 48;
    const fontWeight = typeof meta.fontWeight === "number" ? meta.fontWeight : 400;
    const align = typeof meta.align === "string" ? meta.align : "left";
    const color = typeof meta.color === "string" ? meta.color : "#ffffff";
    const text = String(meta.text || "");

    context.save();
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    context.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
    context.textBaseline = "top";
    context.fillStyle = color;

    const lines = text.split(/\n/g);
    const lineHeight = Math.max(fontSize * 1.25, 1);
    let x = 0;
    if (context.textAlign === "center") x = width / 2;
    if (context.textAlign === "right") x = width;

    for (let i = 0; i < lines.length; i += 1) {
      context.fillText(lines[i], x, i * lineHeight);
    }
    context.restore();

    // Also render any strokes (effects) above text if present
    if (Array.isArray(layer.strokes) && layer.strokes.length > 0) {
      context.save();
      layer.strokes.forEach((stroke) => {
        if (stroke && stroke.tool === "shape") {
          const type = (stroke.type || stroke.options?.shape || "rectangle").toLowerCase();
          const opts = stroke.options || {};
          const geom = stroke.geometry || {};
          context.save();
          context.lineJoin = "round";
          context.lineCap = "round";
          context.lineWidth = Math.max(1, Number(opts.strokeWidth) || 1);
          context.strokeStyle = typeof opts.strokeColor === "string" ? opts.strokeColor : "#ffffff";
          context.fillStyle = typeof opts.fillColor === "string" ? opts.fillColor : "rgba(0,0,0,0)";
          const doStroke = opts.strokeEnabled !== false && (Number(opts.strokeWidth) || 0) > 0;
          const doFill = opts.fillEnabled !== false && type !== "line";

          if (type === "rectangle") {
            const x = Number(geom.x) || 0;
            const y = Number(geom.y) || 0;
            const w = Math.max(0, Number(geom.width) || 0);
            const h = Math.max(0, Number(geom.height) || 0);
            const r = Math.max(0, Math.min(Number(opts.cornerRadius) || 0, Math.min(w, h) / 2));
            context.beginPath();
            if (r > 0) {
              // rounded rect
              context.moveTo(x + r, y);
              context.lineTo(x + w - r, y);
              context.quadraticCurveTo(x + w, y, x + w, y + r);
              context.lineTo(x + w, y + h - r);
              context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
              context.lineTo(x + r, y + h);
              context.quadraticCurveTo(x, y + h, x, y + h - r);
              context.lineTo(x, y + r);
              context.quadraticCurveTo(x, y, x + r, y);
            } else {
              context.rect(x, y, w, h);
            }
            if (doFill) context.fill();
            if (doStroke) context.stroke();
          } else if (type === "ellipse") {
            const cx = (Number(geom.x) || 0) + (Number(geom.width) || 0) / 2;
            const cy = (Number(geom.y) || 0) + (Number(geom.height) || 0) / 2;
            const rx = Math.max(0, (Number(geom.width) || 0) / 2);
            const ry = Math.max(0, (Number(geom.height) || 0) / 2);
            context.beginPath();
            context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            if (doFill) context.fill();
            if (doStroke) context.stroke();
          } else if (type === "line") {
            const x1 = Number(geom.x1) || 0;
            const y1 = Number(geom.y1) || 0;
            const x2 = Number(geom.x2) || 0;
            const y2 = Number(geom.y2) || 0;
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            if (doStroke) context.stroke();
          }
          context.restore();
          return;
        }

        // Default polyline (e.g., brush/eraser)
        const points = Array.isArray(stroke?.points) ? stroke.points : [];
        if (points.length < 2) {
          return;
        }
        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";
        const strokeWidth = Math.max(1.25, 6 / (metrics.zoom || 1));
        context.lineWidth = strokeWidth;
        context.globalAlpha = 0.85;
        context.strokeStyle = `hsla(${(hashStringToHue(layer.id) + 180) % 360}, 72%, 60%, 0.75)`;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          const point = points[index];
          context.lineTo(point.x, point.y);
        }
        context.stroke();
        context.restore();
      });

      context.restore();
    }
    return;
  }

  const assetId = layer?.metadata?.imageAssetId;
  const imageCanvas = assetId ? getAssetCanvas(assetId) : null;
  if (imageCanvas) {
    try {
      context.drawImage(imageCanvas, 0, 0, width, height);
    } catch (e) {
      const gradient = createLayerGradient(context, layer, width, height);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
  } else {
    const gradient = createLayerGradient(context, layer, width, height);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  if (layer.type === "effect") {
    context.save();
    context.globalAlpha = 0.2;
    context.fillStyle = "rgba(255, 255, 255, 0.35)";
    const spacing = Math.max(12, 32 / (metrics.zoom || 1));
    for (let x = 0; x < width + height; x += spacing) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(0, x);
      context.lineTo(0, x + spacing * 0.5);
      context.lineTo(x + spacing * 0.5, 0);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  if (Array.isArray(layer.strokes) && layer.strokes.length > 0) {
    context.save();
    layer.strokes.forEach((stroke) => {
      if (stroke && stroke.tool === "shape") {
        const type = (stroke.type || stroke.options?.shape || "rectangle").toLowerCase();
        const opts = stroke.options || {};
        const geom = stroke.geometry || {};
        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";
        context.lineWidth = Math.max(1, Number(opts.strokeWidth) || 1);
        context.strokeStyle = typeof opts.strokeColor === "string" ? opts.strokeColor : "#ffffff";
        context.fillStyle = typeof opts.fillColor === "string" ? opts.fillColor : "rgba(0,0,0,0)";
        const doStroke = opts.strokeEnabled !== false && (Number(opts.strokeWidth) || 0) > 0;
        const doFill = opts.fillEnabled !== false && type !== "line";

        if (type === "rectangle") {
          const x = Number(geom.x) || 0;
          const y = Number(geom.y) || 0;
          const w = Math.max(0, Number(geom.width) || 0);
          const h = Math.max(0, Number(geom.height) || 0);
          const r = Math.max(0, Math.min(Number(opts.cornerRadius) || 0, Math.min(w, h) / 2));
          context.beginPath();
          if (r > 0) {
            context.moveTo(x + r, y);
            context.lineTo(x + w - r, y);
            context.quadraticCurveTo(x + w, y, x + w, y + r);
            context.lineTo(x + w, y + h - r);
            context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            context.lineTo(x + r, y + h);
            context.quadraticCurveTo(x, y + h, x, y + h - r);
            context.lineTo(x, y + r);
            context.quadraticCurveTo(x, y, x + r, y);
          } else {
            context.rect(x, y, w, h);
          }
          if (doFill) context.fill();
          if (doStroke) context.stroke();
        } else if (type === "ellipse") {
          const cx = (Number(geom.x) || 0) + (Number(geom.width) || 0) / 2;
          const cy = (Number(geom.y) || 0) + (Number(geom.height) || 0) / 2;
          const rx = Math.max(0, (Number(geom.width) || 0) / 2);
          const ry = Math.max(0, (Number(geom.height) || 0) / 2);
          context.beginPath();
          context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          if (doFill) context.fill();
          if (doStroke) context.stroke();
        } else if (type === "line") {
          const x1 = Number(geom.x1) || 0;
          const y1 = Number(geom.y1) || 0;
          const x2 = Number(geom.x2) || 0;
          const y2 = Number(geom.y2) || 0;
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(x2, y2);
          if (doStroke) context.stroke();
        }
        context.restore();
        return;
      }

      // Default polyline (e.g., brush/eraser)
      const points = Array.isArray(stroke?.points) ? stroke.points : [];
      if (points.length < 2) {
        return;
      }
      context.save();
      context.lineJoin = "round";
      context.lineCap = "round";
      const strokeWidth = Math.max(1.25, 6 / (metrics.zoom || 1));
      context.lineWidth = strokeWidth;
      context.globalAlpha = 0.85;
      context.strokeStyle = `hsla(${(hashStringToHue(layer.id) + 180) % 360}, 72%, 60%, 0.75)`;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        context.lineTo(point.x, point.y);
      }
      context.stroke();
      context.restore();
    });

    context.restore();
  }
}

function drawSelectionOutline(context, layer, metrics, options) {
  const width = layer.dimensions?.width ?? 0;
  const height = layer.dimensions?.height ?? 0;
  if (width <= 0 || height <= 0) {
    return;
  }

  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.lineJoin = "miter";
  const dashBase = Math.max(6, 14 / (metrics.zoom || 1));
  context.setLineDash([dashBase, dashBase]);
  const dashOffset = ((performance.now() / 16) % (dashBase * 2)) / (metrics.zoom || 1);
  context.lineDashOffset = -dashOffset;
  context.lineWidth = Math.max(1, 2 / (metrics.zoom || 1));
  context.strokeStyle = options.selectionPrimary;
  context.strokeRect(0, 0, width, height);

  context.setLineDash([]);
  context.lineWidth = Math.max(1, 1.25 / (metrics.zoom || 1));
  context.strokeStyle = options.selectionSecondary;
  context.strokeRect(0, 0, width, height);
  context.restore();
}

function applyViewTransform(context, viewport, metrics) {
  const zoom = clampZoom(viewport?.zoom ?? 1, viewport?.minZoom, viewport?.maxZoom);
  const workspaceWidth = viewport?.size?.width ?? metrics.clientWidth;
  const workspaceHeight = viewport?.size?.height ?? metrics.clientHeight;
  const panX = viewport?.pan?.x ?? 0;
  const panY = viewport?.pan?.y ?? 0;

  const baseX = (metrics.clientWidth - workspaceWidth * zoom) / 2;
  const baseY = (metrics.clientHeight - workspaceHeight * zoom) / 2;

  const translateX = baseX + panX;
  const translateY = baseY + panY;

  context.setTransform(
    zoom * metrics.dpr,
    0,
    0,
    zoom * metrics.dpr,
    translateX * metrics.dpr,
    translateY * metrics.dpr
  );

  return {
    zoom,
    workspaceWidth,
    workspaceHeight,
    translateX,
    translateY,
    baseX,
    baseY,
  };
}

function renderGrid(context, viewport, metrics) {
  const grid = viewport?.grid;
  const visible = grid ? grid.visible !== false : true;
  if (!visible) {
    return;
  }

  const spacing = Math.max(2, Number(grid?.size) || 32);
  const subdivisions = Math.max(1, Math.floor(grid?.subdivisions || 1));
  const workspaceWidth = viewport?.size?.width ?? metrics.clientWidth;
  const workspaceHeight = viewport?.size?.height ?? metrics.clientHeight;
  const zoom = clampZoom(viewport?.zoom ?? 1, viewport?.minZoom, viewport?.maxZoom);

  context.save();
  applyViewTransform(context, viewport, metrics);
  context.lineWidth = 1 / (zoom * metrics.dpr);

  context.strokeStyle = grid?.color || "rgba(255, 255, 255, 0.14)";
  context.beginPath();
  for (let x = 0; x <= workspaceWidth; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, workspaceHeight);
  }
  for (let y = 0; y <= workspaceHeight; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(workspaceWidth, y);
  }
  context.stroke();

  if (subdivisions > 1) {
    const minorSpacing = spacing / subdivisions;
    const subdivisionColor = grid?.subdivisionColor || "rgba(255, 255, 255, 0.06)";
    context.strokeStyle = subdivisionColor;
    context.beginPath();
    for (let x = 0; x <= workspaceWidth; x += minorSpacing) {
      if (Math.abs(x % spacing) < 0.0001) {
        continue;
      }
      context.moveTo(x, 0);
      context.lineTo(x, workspaceHeight);
    }
    for (let y = 0; y <= workspaceHeight; y += minorSpacing) {
      if (Math.abs(y % spacing) < 0.0001) {
        continue;
      }
      context.moveTo(0, y);
      context.lineTo(workspaceWidth, y);
    }
    context.stroke();
  }

  context.restore();
}

export function createCanvasEngine(options = {}) {
  const canvas = options.canvas ?? document.getElementById("workspace-canvas");
  if (!canvas) {
    throw new Error("Canvas engine requires a canvas element");
  }

  const container =
    options.container ??
    canvas.closest("[data-viewport-stage]") ??
    canvas.closest(".workspace-stage") ??
    canvas.parentElement;

  const storeRef = options.store ?? store;
  const bus = options.eventBus ?? eventBus;
  const layerManager = options.layerManager ?? createLayerManager({ store: storeRef, eventBus: bus });
  const engineOptions = { ...DEFAULT_CANVAS_OPTIONS, ...(options.settings || {}) };

  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) {
    throw new Error("Unable to acquire 2D rendering context for canvas engine");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  let disposed = false;
  let frameRequested = false;
  let readyEmitted = false;
  let metrics = {
    dpr: window.devicePixelRatio || 1,
    clientWidth: canvas.clientWidth,
    clientHeight: canvas.clientHeight,
    zoom: 1,
  };

  function captureSnapshot() {
    const state = storeRef.getState();
    return {
      layers: state.layers,
      viewport: state.viewport,
      selection: state.selection,
    };
  }

  let snapshot = captureSnapshot();

  function emit(eventName, detail) {
    if (bus) {
      bus.emit(eventName, detail);
    }
  }

  function updateCanvasMetrics(force = false) {
    const dpr = window.devicePixelRatio || 1;
    const target = container ?? canvas;
    const bounds = target.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (force || canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      storeRef.updateSlice(
        "viewport",
        (viewport) => {
          const canvasMeta = viewport.canvas || {};
          if (
            canvasMeta.width === width &&
            canvasMeta.height === height &&
            canvasMeta.dpr === dpr
          ) {
            return viewport;
          }
          return {
            ...viewport,
            canvas: { width, height, dpr },
          };
        },
        { reason: "viewport:canvas-size" }
      );

      emit("viewport:resize", { width, height, dpr });
    }

    metrics = {
      dpr,
      clientWidth: width,
      clientHeight: height,
      zoom: clampZoom(snapshot.viewport?.zoom ?? 1, snapshot.viewport?.minZoom, snapshot.viewport?.maxZoom),
    };

    return metrics;
  }

  function scheduleRender(reason = "state") {
    if (disposed) {
      return;
    }
    if (!frameRequested) {
      frameRequested = true;
      requestAnimationFrame(() => {
        frameRequested = false;
        render(reason);
      });
    }
  }

  function render(reason) {
    if (disposed) {
      return;
    }

    snapshot = captureSnapshot();
    metrics = updateCanvasMetrics();

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    renderBackground(context, metrics, engineOptions);
    context.restore();

    context.save();
    applyViewTransform(context, snapshot.viewport, metrics);
    renderLayers(context, snapshot, metrics, engineOptions);
    context.restore();

    context.save();
    renderGrid(context, snapshot.viewport, metrics);
    context.restore();

    emit("canvas:render", { reason, metrics, snapshot });

    if (!readyEmitted) {
      readyEmitted = true;
      emit("canvas:ready", { metrics });
    }
  }

  function renderBackground(ctx, metricsSnapshot, optionsSnapshot) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = optionsSnapshot.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pattern = getCheckerPattern(ctx, optionsSnapshot, metricsSnapshot.dpr);
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.globalAlpha = 0.65;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function renderLayers(ctx, state, metricsSnapshot, optionsSnapshot) {
    const selectionItems = new Set(state.selection?.items || []);
    const layers = layerManager.getRenderableLayers({
      state,
      bottomFirst: true,
      excludeHidden: true,
    });

    layers.forEach((layer) => {
      const opacity = normaliseLayerOpacity(layer.opacity);
      if (opacity <= 0) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = resolveBlendMode(layer.blendingMode);

      const transform = normaliseTransform(layer.transform);
      const dims = layer.dimensions || {};
      const width = dims.width || 0;
      const height = dims.height || 0;

      ctx.translate(transform.x, transform.y);
      if (transform.rotation) {
        ctx.translate(width / 2, height / 2);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.translate(-width / 2, -height / 2);
      }
      ctx.scale(transform.scaleX || 1, transform.scaleY || 1);

      drawLayerContent(ctx, layer, metricsSnapshot);

      if (selectionItems.has(layer.id)) {
        drawSelectionOutline(ctx, layer, metricsSnapshot, optionsSnapshot);
      }

      ctx.restore();
    });
  }

  const unsubscribe = storeRef.subscribe(
    (nextState) => {
      snapshot = nextState;
      scheduleRender("state-change");
    },
    {
      selector: (state) => ({
        layers: state.layers,
        viewport: state.viewport,
        selection: state.selection,
      }),
      equality: (next, previous) =>
        previous &&
        next &&
        next.layers === previous.layers &&
        next.viewport === previous.viewport &&
        next.selection === previous.selection,
      fireImmediately: true,
    }
  );

  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined" && container) {
    resizeObserver = new ResizeObserver(() => {
      updateCanvasMetrics(true);
      scheduleRender("resize");
    });
    resizeObserver.observe(container);
  }

  const handleWindowResize = () => {
    updateCanvasMetrics(true);
    scheduleRender("resize");
  };

  window.addEventListener("resize", handleWindowResize);

  scheduleRender("initial");

  return {
    render,
    destroy() {
      disposed = true;
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch (error) {
          console.warn("Canvas engine resize observer disconnect failed", error);
        }
      }
      window.removeEventListener("resize", handleWindowResize);
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    },
    get metrics() {
      return { ...metrics };
    },
    get snapshot() {
      return snapshot;
    },
  };
}

export const canvasEngine = {
  create: createCanvasEngine,
};
