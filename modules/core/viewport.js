import { DEFAULT_VIEWPORT_STATE, deriveViewportState } from "./viewportState.js";

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hasViewportChanged(previous, next) {
  if (previous === next) {
    return false;
  }

  if (previous.scale !== next.scale) {
    return true;
  }

  if (
    previous.translation.x !== next.translation.x ||
    previous.translation.y !== next.translation.y
  ) {
    return true;
  }

  if (previous.rotation !== next.rotation) {
    return true;
  }

  if (
    previous.grid.visible !== next.grid.visible ||
    previous.grid.spacing !== next.grid.spacing ||
    previous.grid.accentEvery !== next.grid.accentEvery ||
    previous.grid.strokeStyle !== next.grid.strokeStyle ||
    previous.grid.accentStyle !== next.grid.accentStyle
  ) {
    return true;
  }

  if (
    previous.viewportSize.width !== next.viewportSize.width ||
    previous.viewportSize.height !== next.viewportSize.height
  ) {
    return true;
  }

  return previous.rotationOrigin.x !== next.rotationOrigin.x || previous.rotationOrigin.y !== next.rotationOrigin.y;
}

function normaliseWheelDelta(event, fallback = 100) {
  const deltaY = event.deltaY;
  if (event.deltaMode === DOM_DELTA_LINE) {
    return deltaY * 16;
  }
  if (event.deltaMode === DOM_DELTA_PAGE) {
    return deltaY * fallback;
  }
  return deltaY;
}

function mergeViewportPatch(base, patch = {}) {
  if (!patch) {
    return base;
  }

  return {
    ...base,
    ...patch,
    translation: patch.translation
      ? { ...base.translation, ...patch.translation }
      : base.translation,
    grid: patch.grid ? { ...base.grid, ...patch.grid } : base.grid,
    constraints: patch.constraints ? { ...base.constraints, ...patch.constraints } : base.constraints,
    viewportSize: patch.viewportSize ? { ...base.viewportSize, ...patch.viewportSize } : base.viewportSize,
    rotationOrigin: patch.rotationOrigin
      ? { ...base.rotationOrigin, ...patch.rotationOrigin }
      : base.rotationOrigin,
  };
}

export class ViewportController {
  constructor(options = {}) {
    const { canvas, container, store = null, eventBus = null } = options;

    if (!canvas) {
      throw new Error("ViewportController requires a canvas element.");
    }

    this.canvas = canvas;
    this.container = container || canvas;
    this.store = store;
    this.eventBus = eventBus;

    this.state = this.initialiseState();

    this.isSpacePressed = false;
    this.isPanning = false;
    this.activePointerId = null;
    this.lastPointer = null;
    this.pendingPanDelta = { x: 0, y: 0 };
    this.panFrame = null;
    this.busSubscriptions = [];

    this.handleStoreChange = this.handleStoreChange.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);

    if (typeof this.store?.subscribe === "function") {
      this.unsubscribeStore = this.store.subscribe(this.handleStoreChange);
    }

    this.attachDOMEvents();
    this.attachBusEvents();
  }

  initialiseState() {
    const state = typeof this.store?.getState === "function" ? this.store.getState() : null;
    const viewport = state?.viewport ? state.viewport : DEFAULT_VIEWPORT_STATE;
    const derived = deriveViewportState(viewport);

    if (!state?.viewport && typeof this.store?.setState === "function") {
      this.store.setState({ viewport: derived }, { silent: true });
    }

    return derived;
  }

  attachDOMEvents() {
    this.container.addEventListener("wheel", this.onWheel, { passive: false });
    this.container.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove, { passive: false });
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.container.addEventListener("contextmenu", this.onContextMenu);
  }

  attachBusEvents() {
    if (!this.eventBus) {
      return;
    }

    this.busSubscriptions.push(
      this.eventBus.on("viewport:set", (payload) => {
        if (!payload) {
          return;
        }
        this.updateViewportState(payload, { emitEvent: false });
      }),
    );

    this.busSubscriptions.push(
      this.eventBus.on("viewport:grid:toggle", ({ visible } = {}) => {
        const nextVisibility = typeof visible === "boolean" ? visible : !this.state.grid.visible;
        this.setGridVisible(nextVisibility);
      }),
    );

    this.busSubscriptions.push(
      this.eventBus.on("viewport:grid:spacing", ({ spacing, accentEvery } = {}) => {
        this.setGridSpacing(spacing, accentEvery);
      }),
    );
  }

  detachDOMEvents() {
    this.container.removeEventListener("wheel", this.onWheel, { passive: false });
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove, { passive: false });
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.container.removeEventListener("contextmenu", this.onContextMenu);
  }

  handleStoreChange(state) {
    if (!state?.viewport) {
      return;
    }

    const next = deriveViewportState(state.viewport);
    if (!hasViewportChanged(this.state, next)) {
      return;
    }

    this.state = next;
    this.updateCursor();
  }

  onWheel(event) {
    event.preventDefault();

    const delta = normaliseWheelDelta(event, this.state.viewportSize.height || 100);
    const zoomIntensity = 0.0018;
    const zoomFactor = Math.exp(-delta * zoomIntensity);

    const currentScale = this.state.scale;
    const { minScale, maxScale } = this.state.constraints;
    const targetScale = clamp(currentScale * zoomFactor, minScale, maxScale);

    if (targetScale === currentScale) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const worldX = pointerX / currentScale - this.state.translation.x;
    const worldY = pointerY / currentScale - this.state.translation.y;

    const nextTranslation = {
      x: pointerX / targetScale - worldX,
      y: pointerY / targetScale - worldY,
    };

    this.updateViewportState({
      scale: targetScale,
      translation: nextTranslation,
    });
  }

  onKeyDown(event) {
    if (event.code === "Space" && !this.isSpacePressed) {
      this.isSpacePressed = true;
      this.updateCursor();
    }
  }

  onKeyUp(event) {
    if (event.code === "Space") {
      this.isSpacePressed = false;
      this.updateCursor();
      if (this.isPanning) {
        this.endPan();
      }
    }
  }

  onPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    if (!this.isSpacePressed) {
      return;
    }

    this.isPanning = true;
    this.activePointerId = event.pointerId;
    this.lastPointer = { x: event.clientX, y: event.clientY };

    try {
      this.container.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore capture errors for browsers that do not support it.
    }

    this.updateCursor();
    event.preventDefault();
  }

  onPointerMove(event) {
    if (!this.isPanning || event.pointerId !== this.activePointerId) {
      return;
    }

    event.preventDefault();

    const nextPosition = { x: event.clientX, y: event.clientY };
    const deltaX = nextPosition.x - this.lastPointer.x;
    const deltaY = nextPosition.y - this.lastPointer.y;

    this.lastPointer = nextPosition;
    this.queuePan(deltaX, deltaY);
  }

  onPointerUp(event) {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    this.endPan();
  }

  onPointerCancel(event) {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    this.endPan();
  }

  onContextMenu(event) {
    if (this.isPanning) {
      event.preventDefault();
    }
  }

  queuePan(deltaX, deltaY) {
    this.pendingPanDelta.x += deltaX;
    this.pendingPanDelta.y += deltaY;

    if (this.panFrame) {
      return;
    }

    this.panFrame = requestAnimationFrame(() => {
      const scale = this.state.scale || 1;
      const worldDelta = {
        x: this.pendingPanDelta.x / scale,
        y: this.pendingPanDelta.y / scale,
      };

      this.pendingPanDelta.x = 0;
      this.pendingPanDelta.y = 0;
      this.panFrame = null;

      const nextTranslation = {
        x: this.state.translation.x + worldDelta.x,
        y: this.state.translation.y + worldDelta.y,
      };

      this.updateViewportState({ translation: nextTranslation });
    });
  }

  endPan() {
    if (this.activePointerId != null) {
      try {
        this.container.releasePointerCapture(this.activePointerId);
      } catch (error) {
        // Ignore capture errors.
      }
    }

    this.isPanning = false;
    this.activePointerId = null;
    this.lastPointer = null;
    this.pendingPanDelta = { x: 0, y: 0 };

    if (this.panFrame) {
      cancelAnimationFrame(this.panFrame);
      this.panFrame = null;
    }

    this.updateCursor();
  }

  setGridVisible(visible, options = {}) {
    const { emitEvent = true } = options;
    const nextVisible = typeof visible === "boolean" ? visible : !this.state.grid.visible;

    if (nextVisible === this.state.grid.visible) {
      return;
    }

    const patchedGrid = { ...this.state.grid, visible: nextVisible };
    this.updateViewportState({ grid: patchedGrid }, { emitEvent });
  }

  setGridSpacing(spacing, accentEvery, options = {}) {
    const { emitEvent = true } = options;
    const parsedSpacing = Number(spacing);
    const parsedAccent = Number(accentEvery);

    const safeSpacing = Number.isFinite(parsedSpacing)
      ? Math.max(1, parsedSpacing)
      : this.state.grid.spacing;

    const safeAccent = Number.isFinite(parsedAccent)
      ? Math.max(1, Math.round(parsedAccent))
      : this.state.grid.accentEvery;

    if (safeSpacing === this.state.grid.spacing && safeAccent === this.state.grid.accentEvery) {
      return;
    }

    const patchedGrid = {
      ...this.state.grid,
      spacing: safeSpacing,
      accentEvery: safeAccent,
    };

    this.updateViewportState({ grid: patchedGrid }, { emitEvent });
  }

  updateViewportState(patch, options = {}) {
    const { emitEvent = true } = options;
    const merged = mergeViewportPatch(this.state, patch);
    const next = deriveViewportState(merged);

    if (!hasViewportChanged(this.state, next)) {
      return;
    }

    this.state = next;

    if (typeof this.store?.setState === "function") {
      this.store.setState({ viewport: next });
    }

    this.updateCursor();

    if (this.eventBus && emitEvent) {
      this.eventBus.emit("viewport:changed", next);
    }

    if (this.eventBus) {
      this.eventBus.emit("render:request");
    }
  }

  renderGrid(ctx, size = null, viewportState = null) {
    const state = viewportState ? deriveViewportState(viewportState) : this.state;

    if (!state.grid.visible) {
      return;
    }

    const { width, height } = size || state.viewportSize;

    if (!width || !height) {
      return;
    }

    const spacing = Math.max(1, state.grid.spacing);
    const accentEvery = Math.max(1, state.grid.accentEvery || 1);
    const scale = state.scale || 1;

    const viewWidth = width / scale;
    const viewHeight = height / scale;
    const minX = -state.translation.x;
    const maxX = minX + viewWidth;
    const minY = -state.translation.y;
    const maxY = minY + viewHeight;

    const primaryLines = [];
    const accentLines = [];

    const startX = Math.floor(minX / spacing) * spacing;
    for (let x = startX; x <= maxX; x += spacing) {
      const index = Math.round(x / spacing);
      const target = Math.abs(index % accentEvery) === 0 ? accentLines : primaryLines;
      target.push({ orientation: "vertical", position: x });
    }

    const startY = Math.floor(minY / spacing) * spacing;
    for (let y = startY; y <= maxY; y += spacing) {
      const index = Math.round(y / spacing);
      const target = Math.abs(index % accentEvery) === 0 ? accentLines : primaryLines;
      target.push({ orientation: "horizontal", position: y });
    }

    ctx.save();
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    this.strokeGridLines(ctx, primaryLines, state.grid.strokeStyle, minX, maxX, minY, maxY);
    this.strokeGridLines(ctx, accentLines, state.grid.accentStyle || state.grid.strokeStyle, minX, maxX, minY, maxY);

    ctx.restore();
  }

  strokeGridLines(ctx, lines, style, minX, maxX, minY, maxY) {
    if (!lines.length) {
      return;
    }

    ctx.beginPath();
    ctx.strokeStyle = style;

    for (const line of lines) {
      if (line.orientation === "vertical") {
        ctx.moveTo(line.position, minY);
        ctx.lineTo(line.position, maxY);
      } else {
        ctx.moveTo(minX, line.position);
        ctx.lineTo(maxX, line.position);
      }
    }

    ctx.stroke();
  }

  updateCursor() {
    if (this.isPanning) {
      this.container.style.cursor = "grabbing";
      return;
    }

    if (this.isSpacePressed) {
      this.container.style.cursor = "grab";
      return;
    }

    this.container.style.cursor = "";
  }

  getState() {
    return this.state;
  }

  destroy() {
    this.detachDOMEvents();

    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }

    if (this.busSubscriptions) {
      this.busSubscriptions.forEach((off) => {
        if (typeof off === "function") {
          off();
        }
      });
      this.busSubscriptions = [];
    }

    if (this.panFrame) {
      cancelAnimationFrame(this.panFrame);
      this.panFrame = null;
    }

    this.container.style.cursor = "";
  }
}
