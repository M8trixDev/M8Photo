import { store } from "../modules/core/store.js";
import { history } from "../modules/core/history.js";
import { eventBus } from "../modules/core/events.js";
import { initialiseAutosave } from "../modules/persist/autosave.js";
import { initToolbar } from "./toolbar.js";
import { initPanels } from "./panels.js";
import { initTools } from "../modules/tools/index.js";
import { createCanvasEngine } from "../modules/core/canvasEngine.js";
import { createViewportController } from "../modules/view/viewport.js";
import { initKeyboardShortcuts } from "./keys.js";

const globalScope = typeof window !== "undefined" ? window : globalThis;
let coreExposed = false;
let canvasEngineInstance = null;
let viewportController = null;
const teardownHandlers = [];

function registerTeardown(task) {
  if (typeof task === "function") {
    teardownHandlers.push(task);
  }
}

function runTeardown() {
  while (teardownHandlers.length) {
    const task = teardownHandlers.pop();
    try {
      task();
    } catch (error) {
      console.warn("Teardown task failed", error);
    }
  }
}

const autosaveController = initialiseAutosave({ store, history, eventBus });

registerTeardown(() => {
  if (typeof autosaveController?.flush === "function") {
    autosaveController.flush("app:teardown");
  }
  if (typeof autosaveController?.destroy === "function") {
    autosaveController.destroy();
  }
});

function exposeCoreModules() {
  if (coreExposed && globalScope.M8PhotoCore) {
    return globalScope.M8PhotoCore;
  }

  const commands = Object.freeze({
    execute: history.execute,
    undo: history.undo,
    redo: history.redo,
    clear: history.clear,
    register: history.registerCommand,
    configure: history.configure,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  });

  const toolsApi = initTools();

  const core = {
    store,
    history,
    events: eventBus,
    commands,
    tools: toolsApi,
  };

  globalScope.M8PhotoCore = core;
  coreExposed = true;

  return core;
}

function shouldRunDevHarness() {
  try {
    const search = globalScope.location?.search || "";

    if (!search) {
      return false;
    }

    const params = new URLSearchParams(search);
    const value = params.get("devHarness");

    if (value === null) {
      return false;
    }

    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  } catch (error) {
    console.warn("Unable to evaluate dev harness flag", error);
    return false;
  }
}

function bootstrapDevHarness() {
  if (!shouldRunDevHarness()) {
    return;
  }

  import("../modules/dev/harness.js")
    .then((module) => {
      if (module && typeof module.runHarness === "function") {
        module.runHarness({ store, history, eventBus, tools: initTools() });
      }
    })
    .catch((error) => {
      console.error("Failed to initialise development harness", error);
    });
}

function bootAppShell() {
  const shellRoot = document.querySelector("[data-app-shell]");
  if (!shellRoot) {
    return;
  }

  const toolsApi = initTools();

  initToolbar(shellRoot);
  initPanels(shellRoot);

  const disposeKeys = initKeyboardShortcuts();
  if (typeof disposeKeys === 'function') {
    registerTeardown(disposeKeys);
  }

  const stage = shellRoot.querySelector("[data-viewport-stage]");
  const canvas = stage?.querySelector("#workspace-canvas");
  const placeholder = stage?.querySelector(".workspace-placeholder");
  const hud = stage?.querySelector("[data-viewport-hud]");
  const gridOverlay = stage?.querySelector("[data-grid-overlay]");

  if (canvas) {
    viewportController = createViewportController({ canvas, container: stage, hud, gridOverlay });
    registerTeardown(() => {
      viewportController?.reset?.({ source: "teardown" });
      viewportController?.destroy?.();
      viewportController = null;
    });

    canvasEngineInstance = createCanvasEngine({ canvas, container: stage });
    registerTeardown(() => {
      canvasEngineInstance?.destroy?.();
      canvasEngineInstance = null;
    });

    const detachReady = eventBus.once("canvas:ready", () => {
      stage?.classList.add("is-ready");
      placeholder?.classList.add("is-hidden");
    });
    registerTeardown(detachReady);

    const detachRender = eventBus.on(
      "canvas:render",
      () => {
        stage?.classList.add("is-ready");
        placeholder?.classList.add("is-hidden");
      },
      { once: true }
    );
    registerTeardown(detachRender);
  }

  initialiseCollapsibles(shellRoot);

  const activeTool = store.getState().tools?.active || "pointer";
  toolsApi.setActive(activeTool, { source: "bootstrap", force: true });

  shellRoot.dataset.activeTool = activeTool;

  const detachToolsListener = eventBus.on("tools:change", (event) => {
    if (!event || !event.detail) {
      return;
    }
    const { tool: nextTool } = event.detail;
    shellRoot.dataset.activeTool = nextTool || "pointer";
  });
  registerTeardown(detachToolsListener);

  shellRoot.classList.add("is-initialised");
}

function initialiseCollapsibles(scope = document) {
  const sections = scope.querySelectorAll("[data-collapsible]");

  sections.forEach((section) => {
    const toggle = section.querySelector("[data-collapsible-toggle]");
    const content = section.querySelector("[data-collapsible-content]");

    if (!toggle || !content) {
      return;
    }

    const collapsedInitial = section.classList.contains("is-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsedInitial));
    content.hidden = collapsedInitial;

    toggle.addEventListener("click", () => {
      const collapsed = section.classList.toggle("is-collapsed");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      content.hidden = collapsed;
    });
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

exposeCoreModules();

autosaveController.ready
  .catch(() => {})
  .finally(() => {
    bootstrapDevHarness();
  });

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", runTeardown, { once: true });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await autosaveController.ready;
  } catch (error) {
    console.warn("[M8Photo] Proceeding without restored workspace state", error);
  }
  bootAppShell();
  registerServiceWorker();
});
