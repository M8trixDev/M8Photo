import { store } from "../modules/core/store.js";
import { history } from "../modules/core/history.js";
import { eventBus } from "../modules/core/events.js";
import { tools } from "../modules/tools/index.js";
import { layerManager } from "../modules/layers/layerManager.js";
import { clampZoom } from "../modules/view/viewport.js";
import { resolveActionFromKey } from "./shortcuts.js";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function isInputLike(target) {
  const el = target;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  const editable = el.getAttribute("contenteditable");
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (editable && editable !== "false") ||
    el.closest("[contenteditable=true]")
  );
}

function getViewport() {
  return store.getState().viewport || {};
}

function updateZoom(nextZoom, meta = {}) {
  const vp = getViewport();
  const clamped = clampZoom(nextZoom, vp.minZoom, vp.maxZoom);
  store.updateSlice(
    "viewport",
    (viewport) => ({ ...viewport, zoom: clamped }),
    { reason: "viewport:zoom", source: meta.source || "keys" }
  );
  if (eventBus) eventBus.emit("viewport:zoom", { zoom: clamped, source: meta.source || "keys" });
}

function resetZoom(meta = {}) {
  store.updateSlice(
    "viewport",
    (viewport) => ({ ...viewport, zoom: 1, pan: { x: 0, y: 0 } }),
    { reason: "viewport:reset", source: meta.source || "keys" }
  );
  if (eventBus) eventBus.emit("viewport:reset", { zoom: 1, source: meta.source || "keys" });
}

function panBy(dx, dy, meta = {}) {
  const vp = getViewport();
  const pan = vp.pan || { x: 0, y: 0 };
  const next = { x: pan.x + dx, y: pan.y + dy };
  store.updateSlice(
    "viewport",
    (viewport) => ({ ...viewport, pan: next }),
    { reason: "viewport:pan", source: meta.source || "keys" }
  );
  if (eventBus) eventBus.emit("viewport:pan", { pan: next, source: meta.source || "keys" });
}

function setActiveTool(id) {
  tools.setActive(id, { source: "keys" });
}

function setActiveLayerOpacity(percent) {
  const id = store.getState().layers?.active;
  if (!id) return;
  const value = Math.max(0, Math.min(1, percent / 100));
  layerManager.updateLayer(id, { opacity: value }, { source: "keys" });
}

let opacityBuffer = "";
let lastOpacityTime = 0;
const OPACITY_WINDOW = 350; // ms

function handleOpacityDigit(key) {
  const now = Date.now();
  if (now - lastOpacityTime > OPACITY_WINDOW) {
    opacityBuffer = "";
  }
  lastOpacityTime = now;
  opacityBuffer += String(key);
  if (opacityBuffer.length === 1) {
    if (key === "0") {
      setActiveLayerOpacity(100);
      opacityBuffer = "";
      return true;
    }
    setActiveLayerOpacity(parseInt(key, 10) * 10);
    return true;
  }
  if (opacityBuffer.length >= 2) {
    const val = Math.min(100, Math.max(0, parseInt(opacityBuffer, 10)));
    setActiveLayerOpacity(val);
    opacityBuffer = "";
    return true;
  }
  return false;
}

export function initKeyboardShortcuts() {
  let spacePanningActive = false;
  let toolBeforeSpace = null;
  function onKeyDown(event) {
    if (!event) return;

    // Avoid interfering with text inputs/contenteditable
    if (isInputLike(event.target)) {
      return;
    }

    const key = event.key;
    const lower = typeof key === "string" ? key.toLowerCase() : "";
    const isMod = isMac ? event.metaKey : event.ctrlKey;

    // Temporary Hand pan with Space
    const isSpace = key === " " || key === "Spacebar" || lower === " " || lower === "space";
    if (isSpace && !spacePanningActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toolBeforeSpace = tools.getActive();
      setActiveTool("hand");
      spacePanningActive = true;
      return;
    }

    // ESC to signal cancel to active tool (viewport may also reset)
    if (key === "Escape") {
      try { eventBus.emit("tools:cancel", {}); } catch (_) {}
      // do not return; allow other handlers to run
    }

    // Undo / Redo
    if (isMod && lower === "z" && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      history.undo();
      return;
    }
    if ((isMod && lower === "z" && event.shiftKey) || (!isMac && isMod && lower === "y")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      history.redo();
      return;
    }

    // Zoom
    if (isMod && (key === "+" || key === "=")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const vp = getViewport();
      updateZoom((vp.zoom ?? 1) * 1.1, { source: "keys" });
      return;
    }
    if (isMod && (key === "-" || key === "_")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const vp = getViewport();
      updateZoom((vp.zoom ?? 1) / 1.1, { source: "keys" });
      return;
    }
    if (isMod && key === "0") {
      event.preventDefault();
      event.stopImmediatePropagation();
      resetZoom({ source: "keys" });
      return;
    }

    // Filters shortcuts
    if (isMod) {
      if (lower === "i") {
        event.preventDefault();
        event.stopImmediatePropagation();
        eventBus.emit("filter:apply", { type: "invert" });
        return;
      }
      if (lower === "u") {
        event.preventDefault();
        event.stopImmediatePropagation();
        eventBus.emit("filter:apply", { type: "saturationHue" });
        return;
      }
      if (lower === "b" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        eventBus.emit("filter:apply", { type: "brightnessContrast" });
        return;
      }
      if (lower === "g" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        eventBus.emit("filter:apply", { type: "grayscale" });
        return;
      }
      if (lower === "b" && event.altKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        eventBus.emit("filter:apply", { type: "blur" });
        return;
      }
      // Selection shortcuts
      if (lower === "a") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const select = tools.getTool("select");
        const vp = store.getState().viewport?.size || { width: 0, height: 0 };
        if (select && typeof select.applyRect === "function") {
          select.applyRect({ x: 0, y: 0, width: Math.max(1, vp.width || 0), height: Math.max(1, vp.height || 0) }, "replace");
        }
        return;
      }
      if (lower === "d") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const select = tools.getTool("select");
        if (select && typeof select.deselect === "function") {
          select.deselect();
        }
        return;
      }
    }

    // Clear/Fill selection
    if (event.shiftKey && (lower === "delete" || key === "Delete")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const select = tools.getTool("select");
      if (select && typeof select.clear === "function") select.clear();
      return;
    }
    if (event.shiftKey && lower === "f5") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const select = tools.getTool("select");
      if (select && typeof select.fill === "function") select.fill();
      return;
    }

    // Pan with arrow keys
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
      const step = event.shiftKey ? 40 : 20;
      let dx = 0;
      let dy = 0;
      if (key === "ArrowLeft") dx = -step;
      if (key === "ArrowRight") dx = step;
      if (key === "ArrowUp") dy = -step;
      if (key === "ArrowDown") dy = step;
      event.preventDefault();
      event.stopImmediatePropagation();
      panBy(dx, dy, { source: "keys" });
      return;
    }

    // Tools and quick toggles
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      // Customisable shortcuts map
      const action = resolveActionFromKey(lower);
      if (action) {
        if (action.startsWith('tool.')) {
          if (action === 'tool.select.marquee' || action === 'tool.select.lasso') {
            const mode = action.endsWith('lasso') ? 'lasso' : 'rect';
            try { tools.updateOptions('select', { lassoMode: mode }, { source: 'keys' }); } catch(_){}
            setActiveTool('select');
          } else {
            const id = action.split('.')[1];
            setActiveTool(id);
          }
          return;
        }
      }

      if (lower === "v") {
        setActiveTool("move");
        return;
      }
      if (lower === "b") {
        setActiveTool("brush");
        return;
      }
      if (lower === "e") {
        setActiveTool("eraser");
        return;
      }
      if (lower === "t") {
        setActiveTool("text");
        return;
      }
      if (lower === "m") {
        setActiveTool("select");
        try { tools.updateOptions('select', { lassoMode: 'rect' }, { source: 'keys' }); } catch(_){}
        return;
      }
      if (lower === "l") {
        setActiveTool("select");
        try { tools.updateOptions('select', { lassoMode: 'lasso' }, { source: 'keys' }); } catch(_){}
        return;
      }
      if (lower === "c") {
        setActiveTool("crop");
        return;
      }
      if (lower === "g") {
        setActiveTool("fill");
        return;
      }
      if (lower === "u") {
        setActiveTool("shape");
        return;
      }
      if (lower === "i") {
        setActiveTool("eyedropper");
        return;
      }
      if (lower === "h") {
        setActiveTool("hand");
        return;
      }
      if (lower === "z") {
        setActiveTool("zoom");
        return;
      }
      // Opacity shortcuts (0-9)
      if (lower >= "0" && lower <= "9") {
        if (handleOpacityDigit(lower)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    }
  }

  function onKeyUp(event) {
    const key = event.key;
    const lower = typeof key === "string" ? key.toLowerCase() : "";
    const isSpace = key === " " || key === "Spacebar" || lower === " " || lower === "space";
    if (isSpace && spacePanningActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = tools.getActive();
      if (current === "hand" && toolBeforeSpace && toolBeforeSpace !== "hand") {
        setActiveTool(toolBeforeSpace);
      }
      toolBeforeSpace = null;
      spacePanningActive = false;
    }
  }

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: true });

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

export default { initKeyboardShortcuts };
