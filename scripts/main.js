import { initToolbar } from "./toolbar.js";
import { initPanels } from "./panels.js";
import { CanvasEngine } from "../modules/core/canvasEngine.js";
import { ViewportController } from "../modules/core/viewport.js";
import { EventBus } from "../modules/core/eventBus.js";
import { createStore } from "../modules/core/store.js";

function bootAppShell() {
  const shellRoot = document.querySelector("[data-app-shell]");
  if (!shellRoot) {
    return;
  }

  initToolbar(shellRoot);
  initPanels(shellRoot);
  initialiseCollapsibles(shellRoot);
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

function initWorkspace() {
  const canvas = document.getElementById("workspace-canvas");
  if (!canvas) {
    return;
  }

  const stage = canvas.closest(".workspace-stage") || canvas.parentElement;
  if (!stage) {
    return;
  }

  const placeholder = stage.querySelector(".workspace-placeholder");

  const store = createStore();
  const eventBus = new EventBus();

  const viewport = new ViewportController({
    canvas,
    container: stage,
    store,
    eventBus,
  });

  const canvasEngine = new CanvasEngine(canvas, {
    container: stage,
    store,
    eventBus,
    viewport,
  });

  registerMockLayers(canvasEngine);
  updateLayerTransformsForSize(canvasEngine, canvasEngine.logicalSize);

  const disposeResize = eventBus.on("viewport:resized", ({ size }) => {
    if (size) {
      updateLayerTransformsForSize(canvasEngine, size);
    }
  });

  viewport.setGridVisible(true);

  if (placeholder) {
    placeholder.hidden = true;
  }

  const disposeShortcuts = registerWorkspaceShortcuts(viewport);

  window.addEventListener(
    "beforeunload",
    () => {
      disposeShortcuts();
      if (typeof disposeResize === "function") {
        disposeResize();
      }
      viewport.destroy();
      canvasEngine.destroy();
    },
    { once: true },
  );

  if (typeof window !== "undefined") {
    window.__M8Workspace = {
      canvasEngine,
      viewport,
      store,
      eventBus,
    };
  }
}

function registerMockLayers(canvasEngine) {
  canvasEngine.registerLayer({
    id: "workspace-backdrop",
    render(ctx, { size }) {
      const { width, height } = size;
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#16161b");
      gradient.addColorStop(0.6, "#111116");
      gradient.addColorStop(1, "#0a0a0d");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = Math.max(1, width * 0.0015);
      ctx.strokeRect(width * 0.1, height * 0.1, width * 0.8, height * 0.78);
    },
  });

  canvasEngine.registerLayer({
    id: "mock-photo",
    opacity: 0.98,
    render(ctx, { size }) {
      const { width, height } = size;
      const photoWidth = width * 0.72;
      const photoHeight = height * 0.68;
      const originX = (width - photoWidth) / 2;
      const originY = (height - photoHeight) / 2;

      const baseGradient = ctx.createLinearGradient(
        originX,
        originY,
        originX + photoWidth,
        originY + photoHeight,
      );
      baseGradient.addColorStop(0, "#314054");
      baseGradient.addColorStop(0.55, "#2b3646");
      baseGradient.addColorStop(1, "#202832");
      ctx.fillStyle = baseGradient;
      ctx.fillRect(originX, originY, photoWidth, photoHeight);

      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.beginPath();
      ctx.arc(originX + photoWidth * 0.58, originY + photoHeight * 0.42, photoHeight * 0.32, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 200, 160, 0.12)";
      ctx.fillRect(
        originX + photoWidth * 0.14,
        originY + photoHeight * 0.18,
        photoWidth * 0.28,
        photoHeight * 0.34,
      );

      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = Math.max(2, photoWidth * 0.004);
      ctx.strokeRect(originX, originY, photoWidth, photoHeight);
    },
    transform: {
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: -1.2,
      originX: canvasEngine.logicalSize.width / 2,
      originY: canvasEngine.logicalSize.height / 2,
    },
  });

  canvasEngine.registerLayer({
    id: "accent-luminosity",
    blendMode: "screen",
    opacity: 0.4,
    dynamic: true,
    render(ctx, { size, timestamp }) {
      const { width, height } = size;
      const wave = (timestamp % 4000) / 4000;
      const angle = wave * Math.PI * 2;
      const centerX = width / 2 + Math.cos(angle) * width * 0.12;
      const centerY = height / 2 + Math.sin(angle) * height * 0.08;
      const radius = Math.max(width, height) * 0.45;

      const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.4)");
      gradient.addColorStop(0.45, "rgba(255, 255, 255, 0.18)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    },
    transform: {
      originX: canvasEngine.logicalSize.width / 2,
      originY: canvasEngine.logicalSize.height / 2,
    },
  });
}

function updateLayerTransformsForSize(canvasEngine, size) {
  if (!size) {
    return;
  }

  const { width, height } = size;

  canvasEngine.updateLayerTransform("mock-photo", {
    translateX: -width * 0.035,
    translateY: -height * 0.04,
    scaleX: 1.03,
    scaleY: 1.03,
    rotation: -1.2,
    originX: width / 2,
    originY: height / 2,
  });

  canvasEngine.updateLayerTransform("accent-luminosity", {
    originX: width / 2,
    originY: height / 2,
  });
}

function registerWorkspaceShortcuts(viewport) {
  const handler = (event) => {
    if (shouldIgnoreWorkspaceShortcut(event)) {
      return;
    }

    if (event.key === "g" || event.key === "G") {
      event.preventDefault();
      viewport.setGridVisible();
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === "[") {
      event.preventDefault();
      const state = viewport.getState();
      const delta = event.shiftKey ? 24 : 8;
      viewport.setGridSpacing(Math.max(4, state.grid.spacing - delta));
    } else if (event.key === "]") {
      event.preventDefault();
      const state = viewport.getState();
      const delta = event.shiftKey ? 24 : 8;
      viewport.setGridSpacing(state.grid.spacing + delta);
    }
  };

  window.addEventListener("keydown", handler);

  return () => {
    window.removeEventListener("keydown", handler);
  };
}

function shouldIgnoreWorkspaceShortcut(event) {
  const target = event.target;
  if (!target) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  if (!tagName) {
    return false;
  }

  const lowered = tagName.toLowerCase();
  return ["input", "textarea", "select", "button"].includes(lowered);
}

document.addEventListener("DOMContentLoaded", () => {
  bootAppShell();
  registerServiceWorker();
  initWorkspace();
});
