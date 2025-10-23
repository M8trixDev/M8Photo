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
import { initFilters } from "../modules/filters/index.js";
import { initSidebar } from "./sidebar.js";
import { initToolPalette } from "./palette.js";
import { initCommandPalette } from "./commandPalette.js";

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
  initSidebar(shellRoot);
  initToolPalette(shellRoot);
  initCommandPalette();
  // Initialise filters system (menus and dialogs)
  try { initFilters(); } catch (e) { console.warn("Filters init failed", e); }

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

    // Simple FPS monitor and render instrumentation
    if (hud && typeof performance !== "undefined") {
      const fpsEl = document.createElement("span");
      fpsEl.className = "workspace-fps";
      fpsEl.setAttribute("aria-label", "Frames per second");
      fpsEl.textContent = "FPS: —";
      hud.appendChild(fpsEl);
      let frames = 0;
      let last = performance.now();
      const detachFps = eventBus.on("canvas:render", () => {
        frames += 1;
        const now = performance.now();
        if (now - last >= 500) {
          const fps = Math.round((frames * 1000) / (now - last));
          fpsEl.textContent = `FPS: ${fps}`;
          frames = 0;
          last = now;
        }
      });
      registerTeardown(detachFps);
    }
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

    const panelId = section.getAttribute("data-panel-id") || "";

    function persistCollapsed(collapsed) {
      try {
        store.updateSlice(
          "ui",
          (ui) => {
            const next = ui || {};
            const panels = next.panels || {};
            const collapsedMap = { ...(panels.collapsed || {}) };
            if (panelId) collapsedMap[panelId] = Boolean(collapsed);
            return { ...next, panels: { ...panels, collapsed: collapsedMap } };
          },
          { reason: "ui:panel-collapse", source: "collapsible" }
        );
      } catch (e) {
        // ignore
      }
    }

    toggle.addEventListener("click", () => {
      const collapsed = section.classList.toggle("is-collapsed");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      content.hidden = collapsed;
      persistCollapsed(collapsed);
    });
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  function showUpdateToast(reg) {
    try {
      let overlay = document.querySelector('.m8-sw-update');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'm8-sw-update';
        overlay.innerHTML = `
          <div class="m8-sw-toast" role="status" aria-live="polite">
            <div class="m8-sw-text">A new version is available.</div>
            <div class="m8-sw-actions">
              <button type="button" class="m8-sw-reload">Reload</button>
              <button type="button" class="m8-sw-dismiss" aria-label="Dismiss">✕</button>
            </div>
          </div>`;
        const style = document.createElement('style');
        style.textContent = `
          .m8-sw-update{position:fixed;left:0;right:0;bottom:0;display:grid;place-items:center;pointer-events:none;z-index:9999}
          .m8-sw-toast{pointer-events:auto;display:flex;gap:.6rem;align-items:center;background:var(--color-surface-raised, #20242c);color:var(--color-text-primary, #fff);border:1px solid var(--color-border, rgba(255,255,255,.16));border-radius:10px;padding:.6rem .75rem;margin:.75rem;box-shadow:0 6px 24px rgba(0,0,0,.3)}
          .m8-sw-actions{display:flex;gap:.4rem}
          .m8-sw-toast button{background:var(--color-surface-highlight, #2a2f39);color:inherit;border:1px solid var(--color-border, rgba(255,255,255,.16));border-radius:8px;padding:.35rem .6rem;cursor:pointer}
          .m8-sw-toast button:hover{background:var(--color-accent-soft, rgba(255,255,255,.08));}
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
      }
      overlay.style.display = 'grid';

      const reloadBtn = overlay.querySelector('.m8-sw-reload');
      const dismissBtn = overlay.querySelector('.m8-sw-dismiss');
      const reload = () => {
        try {
          const waiting = reg && reg.waiting;
          if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
          // When the controller changes, reload to get the new version
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
          }, { once: true });
        } catch (_) {
          window.location.reload();
        }
      };
      const hide = () => { overlay.style.display = 'none'; };
      reloadBtn?.addEventListener('click', reload, { once: true });
      dismissBtn?.addEventListener('click', hide, { once: true });
    } catch (e) {
      // ignore
    }
  }

  try {
    const registration = await navigator.serviceWorker.register("sw.js");

    if (registration.waiting) {
      showUpdateToast(registration);
    }

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateToast(registration);
        }
      });
    });

    // Periodically check for updates in the background
    try { setInterval(() => registration.update().catch(()=>{}), 60_000); } catch (_) {}
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
  try {
    const params = new URLSearchParams(location.search || "");
    const flag = params.get("debugPerf") || params.get("perf");
    if (flag && ["1", "true", "yes", "on"].includes(String(flag).toLowerCase())) {
      globalScope.__M8PHOTO_DEBUG_PERF__ = true;
      try { console.info("[M8Photo] Performance logging enabled"); } catch (_) {}
    }
  } catch (_) {}
  bootAppShell();
  registerServiceWorker();
});
