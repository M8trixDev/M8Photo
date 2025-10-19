import { store } from "../../core/store.js";
import { initTools } from "../../tools/index.js";
import { layerManager } from "../../layers/layerManager.js";
import { getBlendModes } from "../../layers/blendModes.js";

const TOOL_ORDER = [
  { id: "pointer", label: "Pointer", icon: "⬚" },
  { id: "move", label: "Move", icon: "⤧" },
  { id: "brush", label: "Brush", icon: "✎" },
  { id: "eraser", label: "Eraser", icon: "⌫" },
  { id: "fill", label: "Fill", icon: "◍" },
  { id: "shape", label: "Shape", icon: "▭" },
  { id: "text", label: "Text", icon: "T" },
  { id: "crop", label: "Crop", icon: "▦" },
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
        ${renderContextSection()}
        ${renderPointerSection()}
        ${renderMoveSection()}
        ${renderBrushSection("brush")}
        ${renderBrushSection("eraser")}
        ${renderFillSection()}
        ${renderShapeSection()}
        ${renderTextSection()}
      </div>
    </div>
  `;
}

function renderContextSection() {
  const blendOptions = getBlendModes().map((mode) => `<option value="${mode.id}">${escapeHtml(mode.label)}</option>`).join("");
  return `
    <section class="properties-section" data-context-section>
      <h3 class="properties-section__title">Context</h3>
      <p class="properties-section__hint" data-selection-summary>Selection: 0 layers</p>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Layer opacity</span>
          <output data-range-value>100%</output>
        </div>
        <input type="range" min="0" max="100" step="1" data-layer-opacity-range />
      </div>
      <label class="properties-field">
        <span>Blend mode</span>
        <select data-layer-blend-select>
          ${blendOptions}
        </select>
      </label>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-layer-lock-toggle />
        <span>Lock layer</span>
      </label>
    </section>
  `;
}

export function initPropertiesPanel(panelElement) {
  const root = panelElement?.querySelector("[data-properties-panel-root]");
  if (!root) {
    return;
  }

  const toolsApi = initTools();
  const controls = collectControls(root);

  const onStoreUpdate = (slice) => {
    const toolsState = slice.tools;
    updateToolButtons(controls, toolsState.active);
    updateSectionsVisibility(controls, toolsState.active);
    updateMoveControls(controls.move, toolsState.options?.move || toolsApi.getOptions("move"));
    updateBrushControls(controls.brush, toolsState.options?.brush || toolsApi.getOptions("brush"));
    updateBrushControls(controls.eraser, toolsState.options?.eraser || toolsApi.getOptions("eraser"));
    updateFillControls(controls.fill, toolsState.options?.fill || toolsApi.getOptions("fill"));
    updateShapeControls(controls.shape, toolsState.options?.shape || toolsApi.getOptions("shape"));
    updateTextControls(controls.text, toolsState.options?.text || toolsApi.getOptions("text"));
    updateContextControls(controls.context, slice.layers, slice.selection);
  };


  const unsubscribe = store.subscribe(onStoreUpdate, {
    selector: (state) => ({ tools: state.tools, layers: state.layers, selection: state.selection }),
    equality: (a, b) => a && b && a.tools === b.tools && a.layers === b.layers && a.selection === b.selection,
    fireImmediately: true,
  });

  bindToolEvents(controls, toolsApi);
  bindMoveEvents(controls.move, toolsApi);
  bindBrushEvents(controls.brush, toolsApi, "brush");
  bindBrushEvents(controls.eraser, toolsApi, "eraser");
  bindFillEvents(controls.fill, toolsApi);
  bindShapeEvents(controls.shape, toolsApi);
  bindTextEvents(controls.text, toolsApi);
  bindContextEvents(controls.context);

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

function renderFillSection() {
  return `
    <section class="properties-section" data-tool-section="fill" hidden>
      <h3 class="properties-section__title">Fill Options</h3>
      <label class="properties-field">
        <span>Fill color</span>
        <input type="color" data-fill-input="fillColor" />
      </label>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Tolerance</span>
          <output data-range-value>0</output>
        </div>
        <input type="range" min="0" max="255" step="1" data-fill-range="tolerance" />
      </div>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Opacity</span>
          <output data-range-value>0%</output>
        </div>
        <input type="range" min="0" max="100" step="1" data-fill-range="opacity" />
      </div>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-fill-toggle="contiguous" />
        <span>Contiguous region</span>
      </label>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-fill-toggle="respectAlpha" />
        <span>Respect alpha</span>
      </label>
    </section>
  `;
}

function renderShapeSection() {
  return `
    <section class="properties-section" data-tool-section="shape" hidden>
      <h3 class="properties-section__title">Shape Options</h3>
      <label class="properties-field">
        <span>Shape</span>
        <select data-shape-select="shape">
          <option value="rectangle">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="line">Line</option>
        </select>
      </label>
      <label class="properties-field">
        <span>Fill color</span>
        <input type="color" data-shape-input="fillColor" />
      </label>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-shape-toggle="fillEnabled" />
        <span>Fill enabled</span>
      </label>
      <label class="properties-field">
        <span>Stroke color</span>
        <input type="color" data-shape-input="strokeColor" />
      </label>
      <label class="properties-field properties-field--toggle">
        <input type="checkbox" data-shape-toggle="strokeEnabled" />
        <span>Stroke enabled</span>
      </label>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Stroke width</span>
          <output data-range-value>0 px</output>
        </div>
        <input type="range" min="0" max="64" step="1" data-shape-range="strokeWidth" />
      </div>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Corner radius</span>
          <output data-range-value>0 px</output>
        </div>
        <input type="range" min="0" max="128" step="1" data-shape-range="cornerRadius" />
        <small class="properties-field__hint">Applies to rectangles only</small>
      </div>
      <p class="properties-section__hint">Hold Shift while dragging to constrain (square/circle/45° line).</p>
    </section>
  `;
}

function renderTextSection() {
  return `
    <section class="properties-section" data-tool-section="text" hidden>
      <h3 class="properties-section__title">Text Options</h3>
      <label class="properties-field">
        <span>Font family</span>
        <select data-text-select="fontFamily">
          <option value="Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">Inter / System</option>
          <option value="Georgia, serif">Serif</option>
          <option value="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace">Monospace</option>
        </select>
      </label>
      <div class="properties-field properties-field--range">
        <div class="properties-field__header">
          <span>Font size</span>
          <output data-range-value>0 px</output>
        </div>
        <input type="range" min="6" max="256" step="1" data-text-range="fontSize" />
      </div>
      <label class="properties-field">
        <span>Weight</span>
        <select data-text-select="fontWeight">
          <option value="300">Light</option>
          <option value="400">Regular</option>
          <option value="500">Medium</option>
          <option value="600">Semibold</option>
          <option value="700">Bold</option>
        </select>
      </label>
      <label class="properties-field">
        <span>Align</span>
        <select data-text-select="align">
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label class="properties-field">
        <span>Color</span>
        <input type="color" data-text-input="color" />
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

  const contextControls = {
    selectionSummary: root.querySelector('[data-selection-summary]'),
    lock: root.querySelector('[data-layer-lock-toggle]'),
    blend: root.querySelector('[data-layer-blend-select]'),
    opacity: root.querySelector('[data-layer-opacity-range]'),
  };

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

  const textControls = {
    selects: {
      fontFamily: root.querySelector('[data-text-select="fontFamily"]'),
      fontWeight: root.querySelector('[data-text-select="fontWeight"]'),
      align: root.querySelector('[data-text-select="align"]'),
    },
    ranges: {
      fontSize: root.querySelector('[data-text-range="fontSize"]'),
    },
    inputs: {
      color: root.querySelector('[data-text-input="color"]'),
    },
  };

  const fillControls = {
    inputs: {
      fillColor: root.querySelector('[data-fill-input="fillColor"]'),
    },
    ranges: {
      tolerance: root.querySelector('[data-fill-range="tolerance"]'),
      opacity: root.querySelector('[data-fill-range="opacity"]'),
    },
    toggles: {
      contiguous: root.querySelector('[data-fill-toggle="contiguous"]'),
      respectAlpha: root.querySelector('[data-fill-toggle="respectAlpha"]'),
    },
  };

  const shapeControls = {
    selects: {
      shape: root.querySelector('[data-shape-select="shape"]'),
    },
    inputs: {
      fillColor: root.querySelector('[data-shape-input="fillColor"]'),
      strokeColor: root.querySelector('[data-shape-input="strokeColor"]'),
    },
    ranges: {
      strokeWidth: root.querySelector('[data-shape-range="strokeWidth"]'),
      cornerRadius: root.querySelector('[data-shape-range="cornerRadius"]'),
    },
    toggles: {
      fillEnabled: root.querySelector('[data-shape-toggle="fillEnabled"]'),
      strokeEnabled: root.querySelector('[data-shape-toggle="strokeEnabled"]'),
    },
  };

  return {
    buttons: toolButtons,
    sections,
    context: contextControls,
    move: moveControls,
    brush: brushControls,
    eraser: eraserControls,
    fill: fillControls,
    shape: shapeControls,
    text: textControls,
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

function updateContextControls(contextControls, layersState, selectionState) {
  if (!contextControls) return;
  const activeId = layersState?.active || null;
  const selection = Array.isArray(selectionState?.items) ? selectionState.items : [];
  const summaryEl = contextControls.selectionSummary;
  if (summaryEl) {
    const count = selection.length;
    summaryEl.textContent = count === 0 ? "Selection: none" : count === 1 ? "Selection: 1 layer" : `Selection: ${count} layers`;
  }
  const layer = activeId ? layerManager.getLayer(activeId) : null;
  const lockEl = contextControls.lock;
  const blendEl = contextControls.blend;
  const opEl = contextControls.opacity;
  const disabled = !layer;
  if (lockEl) {
    lockEl.disabled = disabled;
    lockEl.checked = Boolean(layer?.locked);
  }
  if (blendEl) {
    blendEl.disabled = disabled;
    if (layer?.blendingMode) blendEl.value = String(layer.blendingMode);
  }
  if (opEl) {
    opEl.disabled = disabled;
    const v = Math.round(((layer?.opacity ?? 1) * 100));
    opEl.value = String(v);
    updateRangeOutput(opEl, `${v}%`);
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

function updateTextControls(textControls, options) {
  if (!textControls) return;
  const safeOptions = options || {};
  const familySel = textControls.selects.fontFamily;
  const weightSel = textControls.selects.fontWeight;
  const alignSel = textControls.selects.align;
  const sizeRange = textControls.ranges.fontSize;
  const colorInput = textControls.inputs.color;
  if (familySel) familySel.value = safeOptions.fontFamily || "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
  if (weightSel) weightSel.value = String(safeOptions.fontWeight ?? 400);
  if (alignSel) alignSel.value = safeOptions.align || "left";
  if (sizeRange) {
    const value = typeof safeOptions.fontSize === "number" ? safeOptions.fontSize : 48;
    sizeRange.value = String(value);
    updateRangeOutput(sizeRange, `${Math.round(value)} px`);
  }
  if (colorInput) colorInput.value = safeOptions.color || "#ffffff";
}

function updateFillControls(fillControls, options) {
  if (!fillControls) return;
  const safe = options || {};
  const colorInput = fillControls.inputs.fillColor;
  if (colorInput) colorInput.value = safe.fillColor || "#000000";
  const tolRange = fillControls.ranges.tolerance;
  if (tolRange) {
    const v = typeof safe.tolerance === "number" ? Math.round(safe.tolerance) : 32;
    tolRange.value = String(v);
    updateRangeOutput(tolRange, String(v));
  }
  const opRange = fillControls.ranges.opacity;
  if (opRange) {
    const ov = Math.round(((safe.opacity ?? 1) * 100));
    opRange.value = String(ov);
    updateRangeOutput(opRange, `${ov}%`);
  }
  const contiguousToggle = fillControls.toggles.contiguous;
  if (contiguousToggle) contiguousToggle.checked = safe.contiguous !== false;
  const alphaToggle = fillControls.toggles.respectAlpha;
  if (alphaToggle) alphaToggle.checked = safe.respectAlpha !== false;
}

function updateShapeControls(shapeControls, options) {
  if (!shapeControls) return;
  const safe = options || {};
  if (shapeControls.selects.shape) shapeControls.selects.shape.value = safe.shape || "rectangle";
  if (shapeControls.inputs.fillColor) shapeControls.inputs.fillColor.value = safe.fillColor || "#000000";
  if (shapeControls.inputs.strokeColor) shapeControls.inputs.strokeColor.value = safe.strokeColor || "#ffffff";
  if (shapeControls.ranges.strokeWidth) {
    const v = typeof safe.strokeWidth === "number" ? Math.round(safe.strokeWidth) : 3;
    shapeControls.ranges.strokeWidth.value = String(v);
    updateRangeOutput(shapeControls.ranges.strokeWidth, `${v} px`);
  }
  if (shapeControls.ranges.cornerRadius) {
    const r = typeof safe.cornerRadius === "number" ? Math.round(safe.cornerRadius) : 0;
    shapeControls.ranges.cornerRadius.value = String(r);
    updateRangeOutput(shapeControls.ranges.cornerRadius, `${r} px`);
  }
  if (shapeControls.toggles.fillEnabled) shapeControls.toggles.fillEnabled.checked = safe.fillEnabled !== false;
  if (shapeControls.toggles.strokeEnabled) shapeControls.toggles.strokeEnabled.checked = safe.strokeEnabled !== false;
}

function bindToolEvents(controls, toolsApi) {
  controls.buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const toolId = button.dataset.toolTarget;
      toolsApi.setActive(toolId, { source: "properties-panel" });
    });
  });
}

function bindContextEvents(contextControls) {
  if (!contextControls) return;
  const lockEl = contextControls.lock;
  const blendEl = contextControls.blend;
  const opEl = contextControls.opacity;

  lockEl?.addEventListener("change", (e) => {
    const state = store.getState();
    const activeId = state.layers?.active;
    if (!activeId) return;
    layerManager.toggleLock(activeId, e.target.checked, { source: "properties-panel" });
  });

  blendEl?.addEventListener("change", (e) => {
    const state = store.getState();
    const activeId = state.layers?.active;
    if (!activeId) return;
    const mode = String(e.target.value || "normal").toLowerCase();
    layerManager.updateLayer(activeId, { blendingMode: mode }, { source: "properties-panel" });
  });

  opEl?.addEventListener("input", (e) => {
    const raw = Number(e.target.value);
    if (Number.isNaN(raw)) return;
    const state = store.getState();
    const activeId = state.layers?.active;
    if (!activeId) return;
    const value = Math.max(0, Math.min(1, raw / 100));
    updateRangeOutput(opEl, `${Math.round(value * 100)}%`);
    layerManager.updateLayer(activeId, { opacity: value }, { source: "properties-panel" });
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

function bindFillEvents(fillControls, toolsApi) {
  if (!fillControls) return;
  const colorInput = fillControls.inputs.fillColor;
  const tolRange = fillControls.ranges.tolerance;
  const opRange = fillControls.ranges.opacity;
  const contToggle = fillControls.toggles.contiguous;
  const alphaToggle = fillControls.toggles.respectAlpha;

  if (colorInput) {
    colorInput.addEventListener("input", (e) => {
      toolsApi.updateOptions("fill", { fillColor: e.target.value }, { source: "properties-panel" });
    });
  }
  if (tolRange) {
    tolRange.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (!Number.isNaN(v)) {
        updateRangeOutput(tolRange, String(v));
        toolsApi.updateOptions("fill", { tolerance: v }, { source: "properties-panel" });
      }
    });
  }
  if (opRange) {
    opRange.addEventListener("input", (e) => {
      const raw = Number(e.target.value);
      if (!Number.isNaN(raw)) {
        updateRangeOutput(opRange, `${Math.round(raw)}%`);
        toolsApi.updateOptions("fill", { opacity: clamp(raw / 100, 0, 1) }, { source: "properties-panel" });
      }
    });
  }
  if (contToggle) {
    contToggle.addEventListener("change", (e) => {
      toolsApi.updateOptions("fill", { contiguous: e.target.checked }, { source: "properties-panel" });
    });
  }
  if (alphaToggle) {
    alphaToggle.addEventListener("change", (e) => {
      toolsApi.updateOptions("fill", { respectAlpha: e.target.checked }, { source: "properties-panel" });
    });
  }
}

function bindShapeEvents(shapeControls, toolsApi) {
  if (!shapeControls) return;
  const shapeSel = shapeControls.selects.shape;
  const fillColor = shapeControls.inputs.fillColor;
  const strokeColor = shapeControls.inputs.strokeColor;
  const strokeWidth = shapeControls.ranges.strokeWidth;
  const cornerRadius = shapeControls.ranges.cornerRadius;
  const fillEnabled = shapeControls.toggles.fillEnabled;
  const strokeEnabled = shapeControls.toggles.strokeEnabled;

  if (shapeSel) {
    shapeSel.addEventListener("change", (e) => {
      toolsApi.updateOptions("shape", { shape: e.target.value }, { source: "properties-panel" });
    });
  }
  if (fillColor) {
    fillColor.addEventListener("input", (e) => {
      toolsApi.updateOptions("shape", { fillColor: e.target.value }, { source: "properties-panel" });
    });
  }
  if (strokeColor) {
    strokeColor.addEventListener("input", (e) => {
      toolsApi.updateOptions("shape", { strokeColor: e.target.value }, { source: "properties-panel" });
    });
  }
  if (strokeWidth) {
    strokeWidth.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (!Number.isNaN(v)) {
        updateRangeOutput(strokeWidth, `${Math.round(v)} px`);
        toolsApi.updateOptions("shape", { strokeWidth: v }, { source: "properties-panel" });
      }
    });
  }
  if (cornerRadius) {
    cornerRadius.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (!Number.isNaN(v)) {
        updateRangeOutput(cornerRadius, `${Math.round(v)} px`);
        toolsApi.updateOptions("shape", { cornerRadius: v }, { source: "properties-panel" });
      }
    });
  }
  if (fillEnabled) {
    fillEnabled.addEventListener("change", (e) => {
      toolsApi.updateOptions("shape", { fillEnabled: e.target.checked }, { source: "properties-panel" });
    });
  }
  if (strokeEnabled) {
    strokeEnabled.addEventListener("change", (e) => {
      toolsApi.updateOptions("shape", { strokeEnabled: e.target.checked }, { source: "properties-panel" });
    });
  }
}

function bindTextEvents(textControls, toolsApi) {
  if (!textControls) return;
  const familySel = textControls.selects.fontFamily;
  const weightSel = textControls.selects.fontWeight;
  const alignSel = textControls.selects.align;
  const sizeRange = textControls.ranges.fontSize;
  const colorInput = textControls.inputs.color;

  if (familySel) {
    familySel.addEventListener("change", (e) => {
      toolsApi.updateOptions("text", { fontFamily: e.target.value }, { source: "properties-panel" });
    });
  }
  if (weightSel) {
    weightSel.addEventListener("change", (e) => {
      const val = Number(e.target.value);
      if (!Number.isNaN(val)) toolsApi.updateOptions("text", { fontWeight: val }, { source: "properties-panel" });
    });
  }
  if (alignSel) {
    alignSel.addEventListener("change", (e) => {
      toolsApi.updateOptions("text", { align: e.target.value }, { source: "properties-panel" });
    });
  }
  if (sizeRange) {
    sizeRange.addEventListener("input", (e) => {
      const raw = Number(e.target.value);
      if (!Number.isNaN(raw)) {
        updateRangeOutput(sizeRange, `${Math.round(raw)} px`);
        toolsApi.updateOptions("text", { fontSize: raw }, { source: "properties-panel" });
      }
    });
  }
  if (colorInput) {
    colorInput.addEventListener("input", (e) => {
      toolsApi.updateOptions("text", { color: e.target.value }, { source: "properties-panel" });
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
