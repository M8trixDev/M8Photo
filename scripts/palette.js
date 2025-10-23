import { tools } from "../modules/tools/index.js";
import { store } from "../modules/core/store.js";
import { getShortcutMap } from "./shortcuts.js";

const TOOL_DESCRIPTORS = [
  { id: "move", label: "Move (V)", icon: "assets/icons/tool-move.svg", action: "tool.move", key: "v" },
  { id: "select", label: "Marquee (M)", icon: "assets/icons/tool-marquee.svg", action: "tool.select.marquee", key: "m", meta: { mode: "rect" } },
  { id: "select-lasso", label: "Lasso (L)", icon: "assets/icons/tool-lasso.svg", action: "tool.select.lasso", key: "l", meta: { mode: "lasso" } },
  { id: "crop", label: "Crop (C)", icon: "assets/icons/tool-crop.svg", action: "tool.crop", key: "c" },
  { id: "brush", label: "Brush (B)", icon: "assets/icons/tool-brush.svg", action: "tool.brush", key: "b" },
  { id: "eraser", label: "Eraser (E)", icon: "assets/icons/tool-eraser.svg", action: "tool.eraser", key: "e" },
  { id: "fill", label: "Fill (G)", icon: "assets/icons/tool-fill.svg", action: "tool.fill", key: "g" },
  { id: "text", label: "Text (T)", icon: "assets/icons/tool-text.svg", action: "tool.text", key: "t" },
  { id: "shape", label: "Shape (U)", icon: "assets/icons/tool-shape.svg", action: "tool.shape", key: "u" },
  { id: "eyedropper", label: "Eyedropper (I)", icon: "assets/icons/tool-eyedropper.svg", action: "tool.eyedropper", key: "i" },
  { id: "hand", label: "Hand (H)", icon: "assets/icons/tool-hand.svg", action: "tool.hand", key: "h" },
  { id: "zoom", label: "Zoom (Z)", icon: "assets/icons/tool-zoom.svg", action: "tool.zoom", key: "z" },
];

function resolveToolId(id) {
  if (id === "select-lasso") {
    return "select";
  }
  return id;
}

function normaliseSelectMode(mode) {
  return mode === "lasso" ? "lasso" : "rect";
}

function getSelectModeFromOptions(options) {
  return normaliseSelectMode(options?.lassoMode);
}

function getPaletteSnapshot(state = store.getState()) {
  const toolsState = state?.tools || {};
  const activeTool = typeof toolsState.active === "string" && toolsState.active.trim() ? toolsState.active : "pointer";
  const selectOptions = toolsState.options?.select || {};
  return {
    activeTool,
    selectMode: getSelectModeFromOptions(selectOptions),
  };
}

function getShortcutBinding(descriptor, shortcutMap) {
  if (!descriptor) {
    return "";
  }
  const map = shortcutMap || {};
  if (descriptor.action && typeof map[descriptor.action] === "string") {
    return map[descriptor.action];
  }
  if (descriptor.key) {
    return descriptor.key;
  }
  return "";
}

function normaliseShortcutForAttribute(value) {
  if (!value) {
    return "";
  }
  return String(value)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("+");
}

function formatShortcutLabel(value) {
  const attr = normaliseShortcutForAttribute(value);
  if (!attr) {
    return "";
  }
  return attr
    .split("+")
    .map((segment) => {
      if (segment.length === 1) {
        return segment.toUpperCase();
      }
      const lower = segment.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" + ");
}

function isDescriptorActive(descriptorId, activeTool, selectMode) {
  if (descriptorId === "select-lasso") {
    return activeTool === "select" && selectMode === "lasso";
  }
  if (descriptorId === "select") {
    return activeTool === "select" && selectMode !== "lasso";
  }
  return resolveToolId(descriptorId) === activeTool;
}

function applyToolMeta(toolId, meta, source) {
  if (toolId === "select" && meta && meta.mode) {
    const mode = normaliseSelectMode(meta.mode);
    try {
      tools.updateOptions("select", { lassoMode: mode }, { source: source || "palette" });
    } catch (_) {
      // ignored
    }
  }
}

function showSubtoolsPlaceholder(button, descriptor) {
  if (!button || !descriptor) {
    return;
  }
  const popover = document.createElement("div");
  popover.className = "tool-subtools-popover";
  popover.setAttribute("role", "menu");
  popover.setAttribute("aria-label", `${descriptor.label} subtools`);
  popover.textContent = "Subtools coming soon";
  document.body.appendChild(popover);
  const rect = button.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${Math.round(rect.top)}px`;
  popover.style.left = `${Math.round(rect.right + 8)}px`;
  const cleanup = () => {
    try {
      document.body.removeChild(popover);
    } catch (_) {
      // ignored
    }
  };
  window.addEventListener("pointerdown", cleanup, { capture: true, once: true });
  setTimeout(cleanup, 1200);
}

function createPaletteButton(descriptor, initialState, handlers = {}) {
  const { isActive = false, shortcut = "" } = initialState || {};
  const onSelect = typeof handlers.onSelect === "function" ? handlers.onSelect : () => {};

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-btn";
  button.dataset.tool = descriptor.id;
  button.setAttribute("title", descriptor.label);
  button.setAttribute("data-tip", descriptor.label);
  button.setAttribute("aria-label", descriptor.label);
  button.setAttribute("aria-pressed", String(Boolean(isActive)));

  if (isActive) {
    button.classList.add("is-active");
  }

  const icon = document.createElement("span");
  icon.className = "tool-btn__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.style.width = "20px";
  icon.style.height = "20px";
  icon.style.display = "inline-block";
  icon.style.backgroundColor = "currentColor";
  icon.style.maskImage = `url(${descriptor.icon})`;
  icon.style.webkitMaskImage = `url(${descriptor.icon})`;
  icon.style.maskRepeat = "no-repeat";
  icon.style.webkitMaskRepeat = "no-repeat";
  icon.style.maskPosition = "center";
  icon.style.webkitMaskPosition = "center";
  icon.style.maskSize = "contain";
  icon.style.webkitMaskSize = "contain";
  button.appendChild(icon);

  const shortcutEl = document.createElement("kbd");
  shortcutEl.className = "tool-kbd";
  button.appendChild(shortcutEl);

  function updateActive(nextActive) {
    const active = Boolean(nextActive);
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("is-active", active);
  }

  function updateShortcut(binding) {
    const attrValue = normaliseShortcutForAttribute(binding);
    if (attrValue) {
      button.setAttribute("aria-keyshortcuts", attrValue);
      shortcutEl.textContent = formatShortcutLabel(attrValue);
      shortcutEl.hidden = false;
    } else {
      button.removeAttribute("aria-keyshortcuts");
      shortcutEl.textContent = "";
      shortcutEl.hidden = true;
    }
  }

  updateActive(isActive);
  updateShortcut(shortcut);

  button.addEventListener("click", () => {
    onSelect(descriptor);
  });

  button.addEventListener("contextmenu", (event) => {
    try {
      event.preventDefault();
    } catch (_) {
      // ignore
    }
    showSubtoolsPlaceholder(button, descriptor);
  });

  let longPressTimer = null;
  button.addEventListener("pointerdown", () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    longPressTimer = setTimeout(() => {
      showSubtoolsPlaceholder(button, descriptor);
    }, 550);
  });

  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  ["pointerup", "pointerleave", "pointercancel", "dragstart"].forEach((type) => {
    button.addEventListener(type, clearLongPress);
  });

  return {
    element: button,
    updateActive,
    updateShortcut,
  };
}

function updateButtonsActive(entries, snapshot) {
  const activeTool = typeof snapshot?.activeTool === "string" && snapshot.activeTool.trim() ? snapshot.activeTool : "pointer";
  const selectMode = normaliseSelectMode(snapshot?.selectMode);

  entries.forEach(({ descriptor, controller }) => {
    controller.updateActive(isDescriptorActive(descriptor.id, activeTool, selectMode));
  });
}

function updateHostState(host, container, snapshot) {
  const activeTool = typeof snapshot?.activeTool === "string" && snapshot.activeTool.trim() ? snapshot.activeTool : "pointer";
  const selectMode = normaliseSelectMode(snapshot?.selectMode);
  if (host) {
    host.dataset.activeTool = activeTool;
    host.dataset.selectMode = selectMode;
  }
  if (container) {
    container.dataset.activeTool = activeTool;
    container.dataset.selectMode = selectMode;
  }
}

export function initToolPalette(scope = document) {
  const host = scope.querySelector("[data-tool-palette-host]");
  if (!host) {
    return undefined;
  }

  if (typeof host.__paletteCleanup === "function") {
    try {
      host.__paletteCleanup();
    } catch (_) {
      // ignore prior cleanup failures
    }
  }

  let container = host.querySelector("[data-tool-palette]");
  if (!container) {
    container = document.createElement("div");
    container.className = "tool-palette";
    container.setAttribute("data-tool-palette", "");
    container.setAttribute("role", "toolbar");
    container.setAttribute("aria-orientation", "vertical");
    container.setAttribute("aria-label", "Tools");
    host.appendChild(container);
  } else {
    container.setAttribute("role", "toolbar");
    container.setAttribute("aria-orientation", "vertical");
    container.setAttribute("aria-label", "Tools");
  }

  container.innerHTML = "";

  const initialSnapshot = getPaletteSnapshot();
  const shortcutMap = getShortcutMap();

  const buttonEntries = TOOL_DESCRIPTORS.map((descriptor) => {
    const controller = createPaletteButton(
      descriptor,
      {
        isActive: isDescriptorActive(
          descriptor.id,
          initialSnapshot.activeTool,
          initialSnapshot.selectMode
        ),
        shortcut: getShortcutBinding(descriptor, shortcutMap),
      },
      {
        onSelect: (selected) => {
          const targetId = resolveToolId(selected.id);
          applyToolMeta(targetId, selected.meta, "palette");
          tools.setActive(targetId, { source: "palette" });
        },
      }
    );
    container.appendChild(controller.element);
    return { descriptor, controller };
  });

  updateButtonsActive(buttonEntries, initialSnapshot);
  updateHostState(host, container, initialSnapshot);

  const unsubscribe = store.subscribe(
    (snapshot) => {
      updateButtonsActive(buttonEntries, snapshot);
      updateHostState(host, container, snapshot);
    },
    {
      selector: (state) => getPaletteSnapshot(state),
      equality: (a, b) => a.activeTool === b.activeTool && a.selectMode === b.selectMode,
    }
  );

  function refreshShortcuts() {
    const map = getShortcutMap();
    buttonEntries.forEach(({ descriptor, controller }) => {
      controller.updateShortcut(getShortcutBinding(descriptor, map));
    });
  }

  const shortcutsListener = () => {
    try {
      refreshShortcuts();
    } catch (_) {
      // ignore refresh failures
    }
  };

  window.addEventListener("m8:shortcuts:updated", shortcutsListener);

  const cleanup = () => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
    window.removeEventListener("m8:shortcuts:updated", shortcutsListener);
    host.__paletteCleanup = null;
  };

  host.__paletteCleanup = cleanup;

  return cleanup;
}
