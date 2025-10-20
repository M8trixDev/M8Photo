import { store, cloneStateValue } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { createMoveTool } from "./move.js";
import { createBrushTool } from "./brush.js";
import { createEraserTool } from "./eraser.js";
import { createTextTool } from "./text.js";
import { createCropTool } from "./crop.js";
import { createFillTool } from "./fill.js";
import { createShapeTool } from "./shape.js";
import { createSelectTool } from "./select.js";
import { createHandTool } from "./hand.js";
import { createZoomTool } from "./zoom.js";
import { createEyedropperTool } from "./eyedropper.js";

 const POINTER_TOOL_ID = "pointer";
  const registry = new Map();
  const adapters = new Map();
  let initialised = false;

const pointerTool = {
  id: POINTER_TOOL_ID,
  label: "Pointer",
  cursor: "default",
  getDefaultOptions() {
    return { cursor: "default" };
  },
  normalizeOptions(nextOptions = {}) {
    return {
      cursor:
        typeof nextOptions.cursor === "string" && nextOptions.cursor.trim() !== ""
          ? nextOptions.cursor.trim()
          : "default",
    };
  },
  getPublicApi() {
    return Object.freeze({
      id: POINTER_TOOL_ID,
      label: "Pointer",
    });
  },
};

export function initTools() {
  if (initialised) {
    return tools;
  }

  registerTool(pointerTool);

  const context = {
    store,
    history,
    eventBus,
    getToolOptions,
    updateToolOptions,
    setActiveTool,
  };

  const moveTool = createMoveTool(context);
  registerTool(moveTool);

  const brushTool = createBrushTool(context);
  registerTool(brushTool);

  const eraserTool = createEraserTool({ ...context, brushTool });
  registerTool(eraserTool);

  const textTool = createTextTool(context);
  registerTool(textTool);

  const cropTool = createCropTool(context);
  registerTool(cropTool);

  const fillTool = createFillTool(context);
  registerTool(fillTool);

  const shapeTool = createShapeTool(context);
  registerTool(shapeTool);

  const selectTool = createSelectTool(context);
  registerTool(selectTool);

  const handTool = createHandTool(context);
  registerTool(handTool);

  const zoomTool = createZoomTool(context);
  registerTool(zoomTool);

  const eyedropperTool = createEyedropperTool(context);
  registerTool(eyedropperTool);

  initialised = true;

  ensureActiveToolRegistered();
  syncCursorFeedback();

  return tools;
}

function registerTool(tool) {
  if (!tool || typeof tool !== "object" || typeof tool.id !== "string") {
    throw new TypeError("Tool definition must be an object with an id");
  }

  if (registry.has(tool.id)) {
    return;
  }

  registry.set(tool.id, tool);

  const adapter = typeof tool.getPublicApi === "function" ? tool.getPublicApi() : tool;
  adapters.set(tool.id, adapter);

  ensureToolOptions(tool.id, tool);
}

function ensureToolOptions(toolId, tool) {
  if (!toolId) {
    return;
  }

  const defaults = typeof tool?.getDefaultOptions === "function" ? tool.getDefaultOptions() : {};

  store.updateSlice(
    "tools",
    (toolsSlice) => {
      const existing = toolsSlice.options?.[toolId];
      const target = existing ? { ...defaults, ...existing } : { ...defaults };
      const normalised = typeof tool?.normalizeOptions === "function" ? tool.normalizeOptions(target, existing, defaults) : target;

      if (existing && shallowEqual(existing, normalised)) {
        return toolsSlice;
      }

      const next = { ...toolsSlice };
      next.options = { ...toolsSlice.options, [toolId]: normalised };
      return next;
    },
    { reason: "tools:ensure-options", tool: toolId }
  );
}

function ensureActiveToolRegistered() {
  const state = store.getState();
  const activeTool = state.tools?.active;

  if (!registry.has(activeTool)) {
    setActiveTool(POINTER_TOOL_ID, { source: "tools:init" });
    return;
  }

  const cursor = getActiveCursor();
  updateCursorFeedback(cursor, { tool: activeTool, silent: true });
}

function syncCursorFeedback() {
  const cursor = getActiveCursor();
  updateCursorFeedback(cursor, { tool: getActiveToolId(), silent: true });
}

function normaliseToolId(toolId) {
  if (typeof toolId !== "string" || toolId.trim() === "") {
    return POINTER_TOOL_ID;
  }

  const normalized = toolId.trim();

  if (registry.has(normalized)) {
    return normalized;
  }

  const lower = normalized.toLowerCase();

  for (const registered of registry.keys()) {
    if (registered.toLowerCase() === lower) {
      return registered;
    }
  }

  return POINTER_TOOL_ID;
}

function safeCall(fn, ...args) {
  if (typeof fn !== "function") {
    return;
  }

  try {
    fn(...args);
  } catch (error) {
    console.error("Tool lifecycle handler failed", error);
  }
}

function updateCursorFeedback(cursor, meta = {}) {
  if (typeof document === "undefined") {
    return;
  }

  const nextCursor = typeof cursor === "string" && cursor.trim() !== "" ? cursor : "default";
  const body = document.body;

  if (body) {
    body.dataset.activeTool = meta.tool || "";
    if (!meta.silent) {
      body.style.cursor = nextCursor === "default" ? "" : nextCursor;
    }
  }

  const canvas = document.getElementById("workspace-canvas");
  if (canvas) {
    canvas.style.cursor = nextCursor;
  }
}

function getActiveToolId() {
  const state = store.getState();
  return typeof state.tools?.active === "string" ? state.tools.active : POINTER_TOOL_ID;
}

function getActiveCursor() {
  const state = store.getState();
  const cursor = state.tools?.cursor;
  return typeof cursor === "string" && cursor.trim() !== "" ? cursor : "default";
}

function setActiveTool(toolId, meta = {}) {
  initTools();

  const nextId = normaliseToolId(toolId);
  const currentId = getActiveToolId();

  if (currentId === nextId && !meta.force) {
    return currentId;
  }

  const previousTool = registry.get(currentId);
  const nextTool = registry.get(nextId) || registry.get(POINTER_TOOL_ID);

  safeCall(previousTool?.onDeactivate, { ...meta, previous: currentId, next: nextId });

  const cursor = nextTool?.cursor || "default";

  store.updateSlice(
    "tools",
    (toolsSlice) => {
      const next = { ...toolsSlice };
      next.active = nextId;
      next.lastUsed = currentId !== nextId ? currentId : toolsSlice.lastUsed;
      next.cursor = cursor;
      return next;
    },
    { reason: "tools:set-active", tool: nextId, previous: currentId, source: meta.source || "manual" }
  );

  safeCall(nextTool?.onActivate, { ...meta, previous: currentId, next: nextId });

  if (eventBus) {
    eventBus.emit("tools:change", {
      tool: nextId,
      previous: currentId,
      cursor,
      source: meta.source || "manual",
    });
    eventBus.emit("tools:cursor", {
      tool: nextId,
      cursor,
    });
  }

  updateCursorFeedback(cursor, { tool: nextId });

  return nextId;
}

function getToolOptions(toolId) {
  initTools();

  const id = normaliseToolId(toolId);
  const state = store.getState();
  const options = state.tools?.options?.[id];

  if (!options) {
    const tool = registry.get(id);
    ensureToolOptions(id, tool);
    return cloneStateValue(store.getState().tools?.options?.[id] || {});
  }

  return cloneStateValue(options);
}

function updateToolOptions(toolId, changes = {}, meta = {}) {
  initTools();

  const id = normaliseToolId(toolId);
  const tool = registry.get(id);

  if (!tool) {
    return null;
  }

  const stateBefore = store.getState();
  const previousOptions = stateBefore.tools?.options?.[id] || {};
  const defaults = typeof tool.getDefaultOptions === "function" ? tool.getDefaultOptions() : {};

  const result = store.updateSlice(
    "tools",
    (toolsSlice) => {
      const existing = toolsSlice.options?.[id] || {};
      const merged = { ...defaults, ...existing, ...changes };
      const normalised = typeof tool.normalizeOptions === "function" ? tool.normalizeOptions(merged, existing, defaults) : merged;

      if (shallowEqual(existing, normalised)) {
        return toolsSlice;
      }

      const next = { ...toolsSlice };
      next.options = { ...toolsSlice.options, [id]: normalised };
      return next;
    },
    { reason: "tools:update-options", tool: id, source: meta.source || "manual" }
  );

  const stateAfter = store.getState();
  const nextOptions = stateAfter.tools?.options?.[id] || {};

  if (!shallowEqual(previousOptions, nextOptions)) {
    safeCall(tool.onOptionsChanged, cloneStateValue(nextOptions), cloneStateValue(previousOptions));
  }

  return result;
}

function shallowEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every((key) => Object.is(a[key], b[key]));
}

export const tools = {
  init: initTools,
  list() {
    initTools();
    return Array.from(registry.keys());
  },
  setActive: setActiveTool,
  getActive: getActiveToolId,
  getCursor: getActiveCursor,
  getOptions: getToolOptions,
  updateOptions: updateToolOptions,
  getTool(toolId) {
    initTools();
    const id = normaliseToolId(toolId);
    return adapters.get(id) || null;
  },
};

export { POINTER_TOOL_ID };
