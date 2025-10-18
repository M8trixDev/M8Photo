import { store } from "../../core/store.js";
import { initTools } from "../../tools/index.js";

const TOOL_ORDER = [
  { id: "pointer", label: "Pointer", icon: "⬚" },
  { id: "move", label: "Move", icon: "⤧" },
  { id: "brush", label: "Brush", icon: "✎" },
  { id: "eraser", label: "Eraser", icon: "⌫" },
];

const MOVE_RANGE_CONFIG = {
  snapTolerance: {
    min: 0,
    max: 24,
    step: 1,
    format: (value) => `${Math.round(value)} px`,
  },
  gridSize: {
    min: 4,
    max: 96,
    step: 2,
    format: (value) => `${Math.round(value)} px`,
  },
  angleIncrement: {
    min: 1,
    max: 45,
    step: 1,
    format: (value) => `${Math.round(value)}°`,
  },
};

const BRUSH_RANGE_CONFIG = {
  size: {
    min: 1,
    max: 256,
    step: 1,
    format: (value) => `${Math.round(value)} px`,
  },
  hardness: {
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${Math.round(value)}%`,
  },
  opacity: {
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${Math.round(value)}%`,
  },
  smoothing: {
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${Math.round(value)}%`,
  },
};

export function renderPropertiesPanel() {
  return `
    <div class="properties-panel" data-properties-panel-root>
      <div class="properties-panel__toolbar" role="toolbar" aria-label="Tool selection">
        ${TOOL_ORDER.map(renderToolButton).join("")}
      </div>
      <div class="properties-panel__body">
        ${renderPointerSection()}
        ${renderMoveSection()}
        ${renderBrushSection("brush")}
        ${renderBrushSection("eraser")}
      </div>
    </div>
  `;
}

export function initPropertiesPanel(panelElement) {
  const root = panelElement?.querySelector("[data-properties-panel-root]");
  if (!root) {
    return;
  }

  const toolsApi = initTools();
  const controls = collectControls(root);

  const onStoreUpdate = (toolsState) => {
    updateToolButtons(controls, toolsState.active);
    updateSectionsVisibility(controls, toolsState.active);
    updateMoveControls(controls.move, toolsState.options?.move || toolsApi.getOptions("move"));
    updateBrushControls(controls.brush, toolsState.options?.brush || toolsApi.getOptions("brush"));
    updateBrushControls(controls.eraser, toolsState.options?.eraser || toolsApi.getOptions("eraser"));
  };

  const unsubscribe = store.subscribe(onStoreUpdate, {
    selector: (state) => state.tools,
    fireImmediately: true,
  });

  bindToolEvents(controls, toolsApi);
  bindMoveEvents(controls.move, toolsApi);
  bindBrushEvents(controls.brush, toolsApi, "brush");
  bindBrushEvents(controls.eraser, toolsApi, "eraser");

  root.dataset.subscription = "active";
  root.addEventListener("panel:dispose", () => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  }, { once: true });
}

function renderToolButton(tool) {
  return `
    <button
      type="button"
      class="properties-tool"
      data-tool-button
      data-tool-target="${tool.id}"
      aria-pressed="false"
    >
      <span class="properties-tool__icon" aria-hidden="true">${tool.icon}</span>
      <span class="properties-tool__label">${tool.label}</span>
    </button>
  `;
}

function renderPointerSection() {
  return `
    <section class="properties-section" data-tool-section="pointer">
      <p class="properties-section__hint">Pointer tool adapts to the workspace context. Select a layer or choose another tool to edit properties.</p>
    </section>
  `;
}

function renderMoveSection() {
  return `
    <section class="properties-section" data-tool-section="move" hidden>
      <h3 class="properties-section__title">Move Options</h3>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-move-toggle="snapToGrid" />
        <span>Snap to grid</span>
      </label>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-move-toggle="snapToGuides" />
        <span>Snap to guides</span>
      </label>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-move-toggle="constrainProportions" />
        <span>Constrain proportions</span>
      </label>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-move-toggle="showHandles" />
        <span>Show handles</span>
      </label>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Snap tolerance</span>
          <output data-range-value>0 px</output>
        </div>
        <input type="range" min="0" max="24" step="1" data-move-range="snapTolerance" />
      </div>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Grid size</span>
          <output data-range-value>0 px</output>
        </div>
        <input type="range" min="4" max="96" step="2" data-move-range="gridSize" />
      </div>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Angle increment</span>
          <output data-range-value>0°</output>
        </div>
        <input type="range" min="1" max="45" step="1" data-move-range="angleIncrement" />
      </div>
    </section>
  `;
}

function renderBrushSection(toolId) {
  const title = toolId === "eraser" ? "Eraser Options" : "Brush Options";
  const toggleLabel = toolId === "eraser" ? "Protect transparency" : "Enable texture";
  const toggleAttr = toolId === "eraser" ? "protectTransparency" : "texture";

  return `
    <section class="properties-section" data-tool-section="${toolId}" hidden>
      <h3 class="properties-section__title">${title}</h3>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Size</span>
          <output data-range-value>0 px</output>
        </div>
        <input type="range" min="1" max="256" step="1" data-brush-range="size" data-tool="${toolId}" />
      </div>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Hardness</span>
          <output data-range-value>0%</output>
        </div>
        <input type="range" min="0" max="100" step="1" data-brush-range="hardness" data-tool="${toolId}" />
      </div>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Opacity</span>
          <output data-range-value>0%</output>
        </div>
        <input type="range" min="0" max="100" step="1" data-brush-range="opacity" data-tool="${toolId}" />
      </div>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Smoothing</span>
          <output data-range-value>0%</output>
        </div>
        <input type="range" min="0" max="100" step="1" data-brush-range="smoothing" data-tool="${toolId}" />
      </div>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-brush-toggle="${toggleAttr}" data-tool="${toolId}" />
        <span>${toggleLabel}</span>
      </label>
    </section>
  `;
}

function collectControls(root) {
  const toolButtons = Array.from(root.querySelectorAll("[data-tool-button]"));
  const sections = new Map();
  root.querySelectorAll("[data-tool-section]").forEach((section) => {
    sections.set(section.getAttribute("data-tool-section"), section);
  });

  const moveControls = {
    toggles: {
      snapToGrid: root.querySelector('[data-move-toggle="snapToGrid"]'),
      snapToGuides: root.querySelector('[data-move-toggle="snapToGuides"]'),
      constrainProportions: root.querySelector('[data-move-toggle="constrainProportions"]'),
      showHandles: root.querySelector('[data-move-toggle="showHandles"]'),
    },
    ranges: {
      snapTolerance: root.querySelector('[data-move-range="snapTolerance"]'),
      gridSize: root.querySelector('[data-move-range="gridSize"]'),
      angleIncrement: root.querySelector('[data-move-range="angleIncrement"]'),
    },
  };

  const brushControls = createBrushControlGroup(root, "brush");
  const eraserControls = createBrushControlGroup(root, "eraser");

  return {
    buttons: toolButtons,
    sections,
    move: moveControls,
    brush: brushControls,
    eraser: eraserControls,
  };
}

function createBrushControlGroup(root, toolId) {
  return {
    toolId,
    toggles: {
      extra: root.querySelector(`[data-brush-toggle][data-tool="${toolId}"]`),
    },
    ranges: {
      size: root.querySelector(`[data-brush-range="size"][data-tool="${toolId}"]`),
      hardness: root.querySelector(`[data-brush-range="hardness"][data-tool="${toolId}"]`),
      opacity: root.querySelector(`[data-brush-range="opacity"][data-tool="${toolId}"]`),
      smoothing: root.querySelector(`[data-brush-range="smoothing"][data-tool="${toolId}"]`),
    },
  };
}

function updateToolButtons(controls, activeTool) {
  controls.buttons.forEach((button) => {
    const isActive = button.dataset.toolTarget === activeTool;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateSectionsVisibility(controls, activeTool) {
  controls.sections.forEach((section, toolId) => {
    section.hidden = toolId !== activeTool;
  });

  if (!controls.sections.has(activeTool)) {
    const pointerSection = controls.sections.get("pointer");
    if (pointerSection) {
      pointerSection.hidden = false;
    }
  }
}

function updateMoveControls(moveControls, options) {
  if (!moveControls) {
    return;
  }

  const safeOptions = options || {};

  Object.entries(moveControls.toggles).forEach(([key, element]) => {
    if (element) {
      element.checked = Boolean(safeOptions[key]);
    }
  });

  Object.entries(moveControls.ranges).forEach(([key, element]) => {
    if (!element) {
      return;
    }
    const config = MOVE_RANGE_CONFIG[key];
    const value = typeof safeOptions[key] === "number" ? safeOptions[key] : config?.min || 0;
    element.value = String(value);
    updateRangeOutput(element, config?.format(value));
  });
}

function updateBrushControls(controlGroup, options) {
  if (!controlGroup) {
    return;
  }

  const safeOptions = options || {};

  Object.entries(controlGroup.ranges).forEach(([key, element]) => {
    if (!element) {
      return;
    }
    const config = BRUSH_RANGE_CONFIG[key];
    let value = 0;
    if (key === "size") {
      value = typeof safeOptions.size === "number" ? safeOptions.size : config.min;
    } else if (key === "hardness") {
      value = Math.round((safeOptions.hardness ?? 0) * 100);
    } else if (key === "opacity") {
      value = Math.round((safeOptions.opacity ?? 0) * 100);
    } else if (key === "smoothing") {
      value = Math.round((safeOptions.smoothing ?? 0) * 100);
    }
    element.value = String(value);
    updateRangeOutput(element, config?.format ? config.format(value) : String(value));
  });

  const toggle = controlGroup.toggles.extra;
  if (toggle) {
    toggle.checked = Boolean(safeOptions[controlGroup.toolId === "eraser" ? "protectTransparency" : "texture"]);
  }
}

function bindToolEvents(controls, toolsApi) {
  controls.buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const toolId = button.dataset.toolTarget;
      toolsApi.setActive(toolId, { source: "properties-panel" });
    });
  });
}

function bindMoveEvents(moveControls, toolsApi) {
  if (!moveControls) {
    return;
  }

  Object.entries(moveControls.toggles).forEach(([key, element]) => {
    if (!element) {
      return;
    }
    element.addEventListener("change", (event) => {
      const checked = event.target.checked;
      toolsApi.updateOptions("move", { [key]: checked }, { source: "properties-panel" });
    });
  });

  Object.entries(moveControls.ranges).forEach(([key, element]) => {
    if (!element) {
      return;
    }
    const config = MOVE_RANGE_CONFIG[key];

    element.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      if (!Number.isNaN(value)) {
        updateRangeOutput(element, config?.format(value));
        toolsApi.updateOptions("move", { [key]: value }, { source: "properties-panel" });
      }
    });
  });
}

function bindBrushEvents(controlGroup, toolsApi, toolId) {
  if (!controlGroup) {
    return;
  }

  Object.entries(controlGroup.ranges).forEach(([key, element]) => {
    if (!element) {
      return;
    }
    const config = BRUSH_RANGE_CONFIG[key];

    element.addEventListener("input", (event) => {
      const rawValue = Number(event.target.value);
      if (Number.isNaN(rawValue)) {
        return;
      }

      updateRangeOutput(element, config?.format ? config.format(rawValue) : String(rawValue));

      let value = rawValue;
      if (key === "hardness" || key === "opacity" || key === "smoothing") {
        value = clamp(rawValue / 100, 0, 1);
      }

      toolsApi.updateOptions(toolId, { [key]: value }, { source: "properties-panel" });
    });
  });

  const toggle = controlGroup.toggles.extra;
  if (toggle) {
    toggle.addEventListener("change", (event) => {
      const optionKey = toolId === "eraser" ? "protectTransparency" : "texture";
      toolsApi.updateOptions(toolId, { [optionKey]: event.target.checked }, { source: "properties-panel" });
    });
  }
}

function updateRangeOutput(input, valueText) {
  const container = input.closest(".properties-field");
  const output = container?.querySelector("[data-range-value]");
  if (output) {
    output.textContent = valueText ?? input.value;
  }
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
