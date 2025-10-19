import { store, DEFAULT_VIEWPORT_GRID } from "../core/store.js";
import { eventBus } from "../core/events.js";

const FALLBACK_MIN_ZOOM = 0.1;
const FALLBACK_MAX_ZOOM = 8;
const WHEEL_ZOOM_SENSITIVITY = 600;

function clampZoom(value, minZoom, maxZoom) {
  const min = typeof minZoom === "number" && !Number.isNaN(minZoom) ? Math.max(minZoom, FALLBACK_MIN_ZOOM) : FALLBACK_MIN_ZOOM;
  const max = typeof maxZoom === "number" && !Number.isNaN(maxZoom) ? Math.max(maxZoom, min) : FALLBACK_MAX_ZOOM;
  const target = typeof value === "number" && !Number.isNaN(value) ? value : 1;
  return Math.min(Math.max(target, min), max);
}

function computeBaseOffset(canvasSize, workspaceSize, zoom) {
  const safeWorkspace = Math.max(1, workspaceSize);
  return (canvasSize - safeWorkspace * zoom) / 2;
}

function normalisePan(pan) {
  if (!pan || typeof pan !== "object") {
    return { x: 0, y: 0 };
  }
  return {
    x: typeof pan.x === "number" && !Number.isNaN(pan.x) ? pan.x : 0,
    y: typeof pan.y === "number" && !Number.isNaN(pan.y) ? pan.y : 0,
  };
}

function getCanvasMetrics(canvas, viewport) {
  const canvasWidth = viewport?.canvas?.width || canvas?.clientWidth || 0;
  const canvasHeight = viewport?.canvas?.height || canvas?.clientHeight || 0;
  return {
    width: canvasWidth,
    height: canvasHeight,
  };
}

export function createViewportController(options = {}) {
  const canvas = options.canvas ?? document.getElementById("workspace-canvas");

  if (!canvas) {
    throw new Error("Viewport controller requires a canvas element");
  }

  const container =
    options.container ??
    canvas.closest("[data-viewport-stage]") ??
    canvas.closest(".workspace-stage") ??
    canvas.parentElement;

  const storeRef = options.store ?? store;
  const bus = options.eventBus ?? eventBus;
  const hudElement = options.hud ?? container?.querySelector("[data-viewport-hud]");
  const gridOverlay = options.gridOverlay ?? container?.querySelector("[data-grid-overlay]");

  const cleanup = [];
  let currentViewport = storeRef.getState().viewport || {};
  let panPointerState = {
    active: false,
    pointerId: null,
    origin: { x: 0, y: 0 },
    panStart: { x: 0, y: 0 },
  };

  if (canvas.style.touchAction !== "none") {
    canvas.style.touchAction = "none";
  }

  function emit(eventName, detail) {
    if (bus) {
      bus.emit(eventName, detail);
    }
  }

  function syncViewportStyles(viewport) {
    const zoom = clampZoom(viewport?.zoom, viewport?.minZoom, viewport?.maxZoom);
    const pan = normalisePan(viewport?.pan);
    const gridState = viewport?.grid || DEFAULT_VIEWPORT_GRID;

    // Batch DOM writes using rAF to reduce layout thrash during continuous pan/zoom
    if (!syncViewportStyles._rafPending) {
      syncViewportStyles._rafPending = true;
      requestAnimationFrame(() => {
        syncViewportStyles._rafPending = false;
        const z = clampZoom((currentViewport?.zoom ?? zoom), viewport?.minZoom, viewport?.maxZoom);
        const p = normalisePan(currentViewport?.pan ?? pan);
        const g = currentViewport?.grid || gridState;

        if (container) {
          container.dataset.zoom = z.toFixed(3);
          container.style.setProperty("--viewport-zoom", z.toFixed(3));
          container.style.setProperty("--viewport-pan-x", `${p.x}px`);
          container.style.setProperty("--viewport-pan-y", `${p.y}px`);
          container.classList.toggle("is-grid-visible", g.visible !== false);
        }

        if (canvas) {
          canvas.dataset.zoom = z.toFixed(3);
          canvas.dataset.panX = p.x.toFixed(2);
          canvas.dataset.panY = p.y.toFixed(2);
        }

        if (gridOverlay) {
          gridOverlay.classList.toggle("is-visible", g.visible !== false);
        }

        if (hudElement) {
          const zoomPercent = `${Math.round(z * 100)}%`;
          hudElement.textContent = zoomPercent;
          hudElement.setAttribute("aria-label", `Zoom ${zoomPercent}`);
        }
      });
    }
  }

  function updateViewport(partial, meta = {}) {
    storeRef.updateSlice(
      "viewport",
      (viewport) => ({
        ...viewport,
        ...partial,
      }),
      meta
    );
  }

  function updatePan(x, y, meta = {}) {
    const next = { x, y };
    updateViewport(
      { pan: next },
      { reason: "viewport:pan", source: meta.source || "viewport" }
    );
    emit("viewport:pan", { pan: next, source: meta.source || "viewport" });
    return next;
  }

  function setZoom(nextZoom, meta = {}) {
    const viewport = currentViewport || storeRef.getState().viewport || {};
    const clamped = clampZoom(nextZoom, viewport.minZoom, viewport.maxZoom);

    if (Math.abs(clamped - (viewport.zoom ?? 1)) < 1e-6) {
      return viewport.zoom ?? clamped;
    }

    const canvasMetrics = getCanvasMetrics(canvas, viewport);
    const workspaceWidth = viewport.size?.width || canvasMetrics.width || 1;
    const workspaceHeight = viewport.size?.height || canvasMetrics.height || 1;
    const pan = normalisePan(viewport.pan);
    const focusPoint = meta.focus || {
      x: canvasMetrics.width / 2,
      y: canvasMetrics.height / 2,
    };

    const currentZoom = clampZoom(viewport.zoom ?? 1, viewport.minZoom, viewport.maxZoom);
    const baseXBefore = computeBaseOffset(canvasMetrics.width, workspaceWidth, currentZoom);
    const baseYBefore = computeBaseOffset(canvasMetrics.height, workspaceHeight, currentZoom);

    const worldX = (focusPoint.x - (baseXBefore + pan.x)) / currentZoom;
    const worldY = (focusPoint.y - (baseYBefore + pan.y)) / currentZoom;

    const baseXAfter = computeBaseOffset(canvasMetrics.width, workspaceWidth, clamped);
    const baseYAfter = computeBaseOffset(canvasMetrics.height, workspaceHeight, clamped);

    const nextPan = {
      x: focusPoint.x - baseXAfter - worldX * clamped,
      y: focusPoint.y - baseYAfter - worldY * clamped,
    };

    updateViewport(
      {
        zoom: clamped,
        pan: nextPan,
      },
      { reason: "viewport:zoom", source: meta.source || "viewport" }
    );

    emit("viewport:zoom", {
      zoom: clamped,
      focus: focusPoint,
      source: meta.source || "viewport",
    });

    return clamped;
  }

  function reset(meta = {}) {
    const viewport = currentViewport || storeRef.getState().viewport || {};
    const defaultZoom = clampZoom(1, viewport.minZoom, viewport.maxZoom);

    updateViewport(
      {
        zoom: defaultZoom,
        pan: { x: 0, y: 0 },
      },
      { reason: "viewport:reset", source: meta.source || "viewport" }
    );

    emit("viewport:reset", { zoom: defaultZoom, source: meta.source || "viewport" });
    return defaultZoom;
  }

  function handlePointerDown(event) {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }

    panPointerState = {
      active: true,
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      panStart: normalisePan(currentViewport.pan),
    };

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore if pointer capture is not supported
    }

    if (container) {
      container.classList.add("is-panning");
    }

    emit("viewport:pan-start", { pointerId: event.pointerId });
  }

  function handlePointerMove(event) {
    if (!panPointerState.active || event.pointerId !== panPointerState.pointerId) {
      return;
    }

    const deltaX = event.clientX - panPointerState.origin.x;
    const deltaY = event.clientY - panPointerState.origin.y;

    const nextPan = {
      x: panPointerState.panStart.x + deltaX,
      y: panPointerState.panStart.y + deltaY,
    };

    updatePan(nextPan.x, nextPan.y, { source: "pointer" });
  }

  function handlePointerUp(event) {
    if (!panPointerState.active || event.pointerId !== panPointerState.pointerId) {
      return;
    }

    panPointerState.active = false;

    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore if pointer capture is not supported
    }

    if (container) {
      container.classList.remove("is-panning");
    }

    emit("viewport:pan-end", { pointerId: event.pointerId });
  }

  function handleWheel(event) {
    const viewport = currentViewport || storeRef.getState().viewport || {};

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const zoom = clampZoom(viewport.zoom ?? 1, viewport.minZoom, viewport.maxZoom);
      const factor = Math.pow(2, -event.deltaY / WHEEL_ZOOM_SENSITIVITY);
      if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-3) {
        return;
      }
      const focus = {
        x: typeof event.offsetX === "number" ? event.offsetX : event.clientX - canvas.getBoundingClientRect().left,
        y: typeof event.offsetY === "number" ? event.offsetY : event.clientY - canvas.getBoundingClientRect().top,
      };
      setZoom(zoom * factor, { source: "wheel", focus });
      return;
    }

    event.preventDefault();
    const pan = normalisePan(viewport.pan);
    const scrollFactor = event.shiftKey ? 0.5 : 1;
    const nextPan = {
      x: pan.x - event.deltaX * scrollFactor,
      y: pan.y - event.deltaY * scrollFactor,
    };
    updatePan(nextPan.x, nextPan.y, { source: "wheel" });
  }

  function handleDoubleClick(event) {
    event.preventDefault();
    const focus = {
      x: typeof event.offsetX === "number" ? event.offsetX : event.clientX - canvas.getBoundingClientRect().left,
      y: typeof event.offsetY === "number" ? event.offsetY : event.clientY - canvas.getBoundingClientRect().top,
    };
    reset({ source: "double-click", focus });
  }

  function handleKeyDown(event) {
    if (!event) {
      return;
    }

    if ((event.key === "0" && (event.metaKey || event.ctrlKey)) || event.key === "Escape") {
      event.preventDefault();
      reset({ source: "keyboard" });
    }

    if ((event.key === "=" || event.key === "+") && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const viewport = currentViewport || storeRef.getState().viewport || {};
      setZoom((viewport.zoom ?? 1) * 1.1, { source: "keyboard" });
    }

    if ((event.key === "-" || event.key === "_") && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const viewport = currentViewport || storeRef.getState().viewport || {};
      setZoom((viewport.zoom ?? 1) / 1.1, { source: "keyboard" });
    }
  }

  function handleViewportChange(nextViewport) {
    currentViewport = nextViewport;
    syncViewportStyles(nextViewport);
  }

  const unsubscribe = storeRef.subscribe(handleViewportChange, {
    selector: (state) => state.viewport,
    equality: Object.is,
    fireImmediately: true,
  });

  cleanup.push(unsubscribe);

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  canvas.addEventListener("dblclick", handleDoubleClick);
  window.addEventListener("keydown", handleKeyDown, { passive: false });

  cleanup.push(() => canvas.removeEventListener("pointerdown", handlePointerDown));
  cleanup.push(() => canvas.removeEventListener("pointermove", handlePointerMove));
  cleanup.push(() => canvas.removeEventListener("pointerup", handlePointerUp));
  cleanup.push(() => canvas.removeEventListener("pointercancel", handlePointerUp));
  cleanup.push(() => canvas.removeEventListener("wheel", handleWheel));
  cleanup.push(() => canvas.removeEventListener("dblclick", handleDoubleClick));
  cleanup.push(() => window.removeEventListener("keydown", handleKeyDown));

  return {
    setZoom,
    updatePan,
    reset,
    destroy() {
      while (cleanup.length) {
        const disposer = cleanup.pop();
        try {
          if (typeof disposer === "function") {
            disposer();
          }
        } catch (error) {
          console.warn("Viewport controller cleanup failed", error);
        }
      }
      panPointerState.active = false;
    },
    get state() {
      return currentViewport;
    },
  };
}

export { clampZoom };
