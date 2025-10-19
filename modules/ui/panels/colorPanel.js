import { store } from "../../core/store.js";
import { initTools } from "../../tools/index.js";

const MAX_SWATCHES = 16;

export function renderColorPanel() {
  const state = store.getState();
  const ui = state.ui || {};
  const colorState = ui.color || {};
  const model = colorState.model || "hex";
  const hex = normalizeHex(colorState.hex || colorState.value || "#000000");
  const opacity = clamp01(typeof colorState.opacity === "number" ? colorState.opacity : 1);
  const rgb = hexToRgb(hex);
  const hsb = rgbToHsb(rgb);
  const swatches = Array.isArray(colorState.swatches) ? colorState.swatches : [];

  return `
    <div class="color-panel" data-color-panel>
      <div class="color-panel__preview" style="--color:${hex}; --alpha:${Math.round(opacity * 100)}%">
        <div class="color-swatch" aria-hidden="true"></div>
        <div class="color-meta">
          <span class="color-meta__hex" data-color-hex-preview>${hex.toUpperCase()}</span>
          <span class="color-meta__alpha" data-color-alpha-preview>${Math.round(opacity * 100)}%</span>
        </div>
      </div>
      <div class="color-panel__controls">
        <div class="properties-field">
          <span>Model</span>
          <select data-color-model>
            <option value="hex" ${model === "hex" ? "selected" : ""}>HEX</option>
            <option value="rgb" ${model === "rgb" ? "selected" : ""}>RGB</option>
            <option value="hsb" ${model === "hsb" ? "selected" : ""}>HSB</option>
          </select>
        </div>
        <div class="properties-field" data-color-inputs data-color-model-section="hex" ${model !== "hex" ? "hidden" : ""}>
          <label class="properties-field">
            <span>HEX</span>
            <input type="text" inputmode="text" spellcheck="false" autocomplete="off" data-color-hex value="${hex.toUpperCase()}" aria-label="Hex color" />
          </label>
        </div>
        <div class="properties-field properties-field--group" data-color-inputs data-color-model-section="rgb" ${model !== "rgb" ? "hidden" : ""}>
          <label class="properties-field">
            <span>R</span>
            <input type="number" min="0" max="255" step="1" data-color-r value="${rgb.r}" aria-label="Red" />
          </label>
          <label class="properties-field">
            <span>G</span>
            <input type="number" min="0" max="255" step="1" data-color-g value="${rgb.g}" aria-label="Green" />
          </label>
          <label class="properties-field">
            <span>B</span>
            <input type="number" min="0" max="255" step="1" data-color-b value="${rgb.b}" aria-label="Blue" />
          </label>
        </div>
        <div class="properties-field properties-field--group" data-color-inputs data-color-model-section="hsb" ${model !== "hsb" ? "hidden" : ""}>
          <label class="properties-field">
            <span>H</span>
            <input type="number" min="0" max="360" step="1" data-color-h value="${Math.round(hsb.h)}" aria-label="Hue" />
          </label>
          <label class="properties-field">
            <span>S</span>
            <input type="number" min="0" max="100" step="1" data-color-s value="${Math.round(hsb.s)}" aria-label="Saturation" />
          </label>
          <label class="properties-field">
            <span>B</span>
            <input type="number" min="0" max="100" step="1" data-color-bri value="${Math.round(hsb.b)}" aria-label="Brightness" />
          </label>
        </div>
        <div class="properties-field properties-field--range">
          <div class="properties-field__header">
            <span>Opacity</span>
            <output data-range-value>${Math.round(opacity * 100)}%</output>
          </div>
          <input type="range" min="0" max="100" step="1" data-color-opacity value="${Math.round(opacity * 100)}" />
        </div>
        <label class="properties-field">
          <span>Apply to</span>
          <select data-color-apply-target>
            <option value="auto" selected>Auto (by tool)</option>
            <option value="fill">Shape Fill / Fill Tool</option>
            <option value="stroke">Shape Stroke</option>
            <option value="text">Text</option>
          </select>
        </label>
      </div>
      <div class="color-panel__swatches" data-color-swatches>
        ${swatches.map((c) => renderSwatch(c)).join("")}
      </div>
    </div>
  `;
}

function renderSwatch(s) {
  const color = typeof s === "string" ? s : s?.hex || s?.color || "#000000";
  let alpha = typeof s?.opacity === "number" ? s.opacity : 1;
  alpha = clamp01(alpha);
  const hex = normalizeHex(color);
  return `<button type="button" class="color-swatch-btn" data-swatch="${hex}" data-alpha="${alpha}" style="--color:${hex}; --alpha:${Math.round(
    alpha * 100
  )}%"><span class="sr-only">${hex.toUpperCase()} ${Math.round(alpha * 100)}%</span></button>`;
}

export function initColorPanel(panelElement) {
  const root = panelElement?.querySelector("[data-color-panel]");
  if (!root) return;

  const modelSelect = root.querySelector("[data-color-model]");
  const hexInput = root.querySelector("[data-color-hex]");
  const rInput = root.querySelector("[data-color-r]");
  const gInput = root.querySelector("[data-color-g]");
  const bInput = root.querySelector("[data-color-b]");
  const hInput = root.querySelector("[data-color-h]");
  const sInput = root.querySelector("[data-color-s]");
  const briInput = root.querySelector("[data-color-bri]");
  const opacityRange = root.querySelector("[data-color-opacity]");
  const swatchesContainer = root.querySelector("[data-color-swatches]");
  const applyTarget = root.querySelector("[data-color-apply-target]");

  const toolsApi = initTools();

  const setPreview = (hex, opacity) => {
    const prevHex = root.querySelector("[data-color-hex-preview]");
    const prevAlpha = root.querySelector("[data-color-alpha-preview]");
    const preview = root.querySelector(".color-panel__preview");
    if (prevHex) prevHex.textContent = hex.toUpperCase();
    if (prevAlpha) prevAlpha.textContent = `${Math.round(opacity * 100)}%`;
    if (preview) {
      preview.style.setProperty("--color", hex);
      preview.style.setProperty("--alpha", `${Math.round(opacity * 100)}%`);
    }
  };

  function applyColorToTools(hex, opacity) {
    const active = store.getState().tools?.active || "pointer";
    const target = applyTarget?.value || "auto";

    const update = (toolId, changes) => toolsApi.updateOptions(toolId, changes, { source: "color-panel" });

    if (target === "text" || active === "text") {
      update("text", { color: hex });
    }

    if (target === "fill" || active === "fill") {
      update("fill", { fillColor: hex, opacity });
    }

    if (target === "stroke" || (active === "shape" && target !== "fill" && target !== "text")) {
      update("shape", { strokeColor: hex });
    }

    if (active === "shape" && (target === "fill" || target === "auto")) {
      update("shape", { fillColor: hex });
    }
  }

  function persistColorState(next) {
    store.updateSlice(
      "ui",
      (ui) => {
        const state = ui || {};
        const color = state.color || {};
        const merged = { ...color, ...next };
        const hex = normalizeHex(merged.hex || merged.value || "#000000");
        const opacity = clamp01(typeof merged.opacity === "number" ? merged.opacity : 1);
        const swatches = Array.isArray(merged.swatches) ? merged.swatches.slice() : color.swatches || [];
        // Add to history if changed
        const key = `${hex}|${opacity}`;
        const last = Array.isArray(swatches) && swatches.length ? swatches[0] : null;
        const lastKey = last ? `${normalizeHex(last.hex || last.color || last)}|${clamp01(last.opacity ?? 1)}` : null;
        if (key !== lastKey) {
          swatches.unshift({ hex, opacity });
        }
        const deduped = [];
        const seen = new Set();
        for (const s of swatches) {
          const h = normalizeHex(s.hex || s.color || s);
          const a = clamp01(s.opacity ?? 1);
          const k = `${h}|${a}`;
          if (!seen.has(k)) {
            deduped.push({ hex: h, opacity: a });
            seen.add(k);
          }
          if (deduped.length >= MAX_SWATCHES) break;
        }
        return { ...state, color: { model: merged.model || color.model || "hex", hex, opacity, swatches: deduped } };
      },
      { reason: "ui:color", source: "color-panel" }
    );
  }

  function updateUiFromState() {
    const state = store.getState();
    const c = state.ui?.color || {};
    const hex = normalizeHex(c.hex || c.value || "#000000");
    const rgb = hexToRgb(hex);
    const hsb = rgbToHsb(rgb);
    const opacity = clamp01(typeof c.opacity === "number" ? c.opacity : 1);
    if (hexInput) hexInput.value = hex.toUpperCase();
    if (rInput) rInput.value = String(rgb.r);
    if (gInput) gInput.value = String(rgb.g);
    if (bInput) bInput.value = String(rgb.b);
    if (hInput) hInput.value = String(Math.round(hsb.h));
    if (sInput) sInput.value = String(Math.round(hsb.s));
    if (briInput) briInput.value = String(Math.round(hsb.b));
    if (opacityRange) opacityRange.value = String(Math.round(opacity * 100));
    updateRangeOutput(opacityRange, `${Math.round(opacity * 100)}%`);
    setPreview(hex, opacity);
    // swatches
    if (swatchesContainer) {
      const swatches = Array.isArray(c.swatches) ? c.swatches : [];
      swatchesContainer.innerHTML = swatches.map((sw) => renderSwatch(sw)).join("");
    }
  }

  function setModel(model) {
    root.querySelectorAll("[data-color-model-section]").forEach((el) => {
      el.hidden = el.getAttribute("data-color-model-section") !== model;
    });
    if (modelSelect) modelSelect.value = model;
    store.updateSlice(
      "ui",
      (ui) => ({ ...ui, color: { ...(ui?.color || {}), model } }),
      { reason: "ui:color-model", source: "color-panel" }
    );
  }

  modelSelect?.addEventListener("change", (e) => {
    const model = e.target.value;
    setModel(model);
  });

  hexInput?.addEventListener("change", () => {
    const parsed = parseHex(hexInput.value);
    const valid = !!parsed;
    if (!valid) {
      // revert to state
      updateUiFromState();
      return;
    }
    const hex = normalizeHex(parsed.hex);
    const opacity = clamp01(getCurrentOpacity());
    persistColorState({ hex, opacity });
    setPreview(hex, opacity);
    applyColorToTools(hex, opacity);
  });

  [rInput, gInput, bInput].forEach((input) => {
    input?.addEventListener("change", () => {
      const r = clampInt(parseInt(rInput.value, 10), 0, 255);
      const g = clampInt(parseInt(gInput.value, 10), 0, 255);
      const b = clampInt(parseInt(bInput.value, 10), 0, 255);
      const hex = rgbToHex({ r, g, b });
      const opacity = clamp01(getCurrentOpacity());
      persistColorState({ hex, opacity });
      setPreview(hex, opacity);
      applyColorToTools(hex, opacity);
    });
  });

  [hInput, sInput, briInput].forEach((input) => {
    input?.addEventListener("change", () => {
      const h = clampInt(parseInt(hInput.value, 10), 0, 360);
      const s = clampInt(parseInt(sInput.value, 10), 0, 100);
      const b = clampInt(parseInt(briInput.value, 10), 0, 100);
      const rgb = hsbToRgb({ h, s, b });
      const hex = rgbToHex(rgb);
      const opacity = clamp01(getCurrentOpacity());
      persistColorState({ hex, opacity });
      setPreview(hex, opacity);
      applyColorToTools(hex, opacity);
    });
  });

  opacityRange?.addEventListener("input", () => {
    const percent = clampInt(parseInt(opacityRange.value, 10), 0, 100);
    const opacity = clamp01(percent / 100);
    updateRangeOutput(opacityRange, `${Math.round(opacity * 100)}%`);
    const { hex } = store.getState().ui?.color || { hex: "#000000" };
    const nextHex = normalizeHex(hex || "#000000");
    persistColorState({ hex: nextHex, opacity });
    applyColorToTools(nextHex, opacity);
    setPreview(nextHex, opacity);
  });

  swatchesContainer?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-swatch]");
    if (!btn) return;
    const hex = normalizeHex(btn.getAttribute("data-swatch") || "#000000");
    const opacity = clamp01(parseFloat(btn.getAttribute("data-alpha")) || 1);
    persistColorState({ hex, opacity });
    updateUiFromState();
    applyColorToTools(hex, opacity);
  });

  const unsubscribe = store.subscribe(
    (state) => state.ui?.color,
    {
      selector: (state) => state.ui?.color,
      equality: (a, b) => a === b,
      fireImmediately: true,
    }
  );

  root.addEventListener(
    "panel:dispose",
    () => {
      if (typeof unsubscribe === "function") unsubscribe();
    },
    { once: true }
  );
}

// Utilities
function parseHex(value) {
  if (typeof value !== "string") return null;
  let v = value.trim();
  if (!v) return null;
  if (v[0] !== "#") v = `#${v}`;
  const m3 = /^#([0-9a-f]{3})$/i.exec(v);
  if (m3) {
    const r = m3[1][0];
    const g = m3[1][1];
    const b = m3[1][2];
    return { hex: `#${r}${r}${g}${g}${b}${b}` };
  }
  const m6 = /^#([0-9a-f]{6})$/i.exec(v);
  if (m6) return { hex: `#${m6[1]}` };
  const m8 = /^#([0-9a-f]{8})$/i.exec(v);
  if (m8) return { hex: `#${m8[1].slice(0, 6)}` };
  return null;
}

function normalizeHex(hex) {
  const p = parseHex(hex);
  if (p) return p.hex.toLowerCase();
  return "#000000";
}

function hexToRgb(hex) {
  const p = parseHex(hex);
  const h = p ? p.hex.slice(1) : "000000";
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return { r, g, b };
}

function rgbToHex({ r, g, b }) {
  const toHex = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsb({ r, g, b }) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, b: v };
}

function hsbToRgb({ h, s, b }) {
  const hh = (h % 360 + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const vv = Math.max(0, Math.min(100, b)) / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (hh < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (hh < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (hh < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (hh < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b2 = Math.round((b1 + m) * 255);
  return { r, g, b: b2 };
}

function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function updateRangeOutput(input, valueText) {
  const container = input?.closest?.(".properties-field");
  const output = container?.querySelector?.("[data-range-value]");
  if (output) output.textContent = valueText || String(input.value);
}
