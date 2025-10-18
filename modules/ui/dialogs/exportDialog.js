import { store } from "../../core/store.js";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "class") {
      node.className = String(value || "");
    } else if (key === "style" && value && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined) {
      node.setAttribute(key, String(value));
    }
  });
  const list = Array.isArray(children) ? children : [children];
  list.forEach((child) => {
    if (child == null) return;
    if (typeof child === "string") {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  });
  return node;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export function showExportDialog({ defaultFileName, baseSize, onRequestPreview, onConfirm }) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "m8-modal-overlay" });
    const dialog = el("div", { class: "m8-modal" });
    const title = el("h2", { class: "m8-modal__title" }, "Export");

    const form = el("form", { class: "m8-export__form" });

    const projectName = defaultFileName || store.getState().project?.name || "Untitled";
    let format = "png";
    let quality = 0.92;
    let scale = 1;

    const fileInput = el("input", { type: "text", value: projectName, class: "m8-input", id: "m8-export-name" });

    const formatSelect = el(
      "select",
      { class: "m8-select", id: "m8-export-format", name: "format" },
      [el("option", { value: "png", selected: "selected" }, "PNG"), el("option", { value: "jpg" }, "JPG")]
    );

    const qualityWrap = el("div", { class: "m8-field" }, [
      el("label", { for: "m8-export-quality" }, "Quality"),
      el("input", { type: "range", id: "m8-export-quality", min: "0.1", max: "1", step: "0.01", value: String(quality) }),
      el("output", { id: "m8-export-quality-out" }, `${Math.round(quality * 100)}%`),
    ]);

    const scaleWrap = el("div", { class: "m8-field" }, [
      el("label", { for: "m8-export-scale" }, "Scale"),
      el("input", { type: "range", id: "m8-export-scale", min: "0.1", max: "4", step: "0.01", value: String(scale) }),
      el("output", { id: "m8-export-scale-out" }, `${Math.round(scale * 100)}%`),
    ]);

    const dimsOut = el("p", { class: "m8-export__dims" }, "");

    const previewBox = el("div", { class: "m8-preview" }, []);
    const previewNote = el("p", { class: "m8-preview__note" }, "Preview updates as you change settings.");

    const buttons = el("div", { class: "m8-modal__actions" }, [
      el("button", { type: "button", class: "m8-btn", id: "m8-export-cancel" }, "Cancel"),
      el("button", { type: "submit", class: "m8-btn m8-btn--primary" }, "Export"),
    ]);

    form.appendChild(el("label", { for: "m8-export-name" }, "File name"));
    form.appendChild(fileInput);

    form.appendChild(el("label", { for: "m8-export-format" }, "Format"));
    form.appendChild(formatSelect);

    form.appendChild(qualityWrap);
    form.appendChild(scaleWrap);
    form.appendChild(dimsOut);
    form.appendChild(previewBox);
    form.appendChild(previewNote);
    form.appendChild(buttons);

    dialog.appendChild(title);
    dialog.appendChild(form);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    applyStyles();

    function updateDims() {
      const width = Math.max(1, baseSize?.width || 1);
      const height = Math.max(1, baseSize?.height || 1);
      dimsOut.textContent = `${Math.floor(width * scale)} × ${Math.floor(height * scale)} px`;
    }

    function updatePreview() {
      previewBox.innerHTML = "";
      try {
        const canvas = onRequestPreview({ scale, format, quality });
        if (canvas) {
          const maxW = 420;
          const maxH = 240;
          const r = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
          const preview = document.createElement("canvas");
          preview.width = Math.max(1, Math.floor(canvas.width * r));
          preview.height = Math.max(1, Math.floor(canvas.height * r));
          const ctx = preview.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
          previewBox.appendChild(preview);
        }
      } catch (e) {
        // ignore
      }
    }

    function onFormatChange() {
      format = formatSelect.value === "jpg" ? "jpg" : "png";
      qualityWrap.style.display = format === "jpg" ? "grid" : "none";
      updatePreview();
    }

    function onQualityChange(e) {
      const value = Number(e.target.value);
      quality = clamp(value, 0.1, 1);
      document.getElementById("m8-export-quality-out").textContent = `${Math.round(quality * 100)}%`;
      updatePreview();
    }

    function onScaleChange(e) {
      const value = Number(e.target.value);
      scale = clamp(value, 0.1, 4);
      document.getElementById("m8-export-scale-out").textContent = `${Math.round(scale * 100)}%`;
      updateDims();
      updatePreview();
    }

    formatSelect.addEventListener("change", onFormatChange);
    qualityWrap.querySelector("#m8-export-quality").addEventListener("input", onQualityChange);
    scaleWrap.querySelector("#m8-export-scale").addEventListener("input", onScaleChange);

    document.getElementById("m8-export-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve({ cancelled: true });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = fileInput.value || projectName;
      await onConfirm({ format, quality, scale, fileName: name });
      overlay.remove();
      resolve({ cancelled: false, format, quality, scale });
    });

    // Initialise UI
    onFormatChange();
    updateDims();
    updatePreview();
  });
}

function applyStyles() {
  if (document.getElementById("m8-export-styles")) return;
  const style = document.createElement("style");
  style.id = "m8-export-styles";
  style.textContent = `
  .m8-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; z-index: 1000; }
  .m8-modal { width: min(720px, 94vw); max-width: 720px; background: var(--color-surface-raised, #1e1e1e); color: var(--color-text-primary, #fff); border: 1px solid var(--color-border, rgba(255,255,255,0.12)); border-radius: 12px; box-shadow: var(--shadow-soft, 0 12px 48px rgba(0,0,0,0.4)); padding: 1rem 1.1rem; }
  .m8-modal__title { margin: 0 0 0.75rem 0; font-size: 1.1rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-secondary, #ddd); }
  .m8-export__form { display: grid; gap: 0.6rem; }
  .m8-field { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0.5rem; }
  .m8-export__dims { font-size: 0.85rem; color: var(--color-text-muted, #aaa); margin: 0.25rem 0 0; }
  .m8-preview { display: grid; place-items: center; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; min-height: 180px; }
  .m8-preview__note { margin: 0; font-size: 0.8rem; color: var(--color-text-muted, #aaa); text-align: center; }
  .m8-modal__actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem; }
  .m8-btn { padding: 0.55rem 1rem; border-radius: 999px; background: var(--color-surface-highlight, #2a2a2a); color: var(--color-text-secondary, #ddd); border: 1px solid var(--color-border, rgba(255,255,255,0.12)); }
  .m8-btn--primary { background: var(--color-accent-soft, rgba(96,178,255,0.16)); color: var(--color-text-primary, #fff); border-color: rgba(255,255,255,0.24); }
  .m8-input, .m8-select { padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid var(--color-border, rgba(255,255,255,0.12)); background: var(--color-surface-highlight, #2a2a2a); color: var(--color-text-primary, #fff); }
  input[type="range"] { width: 100%; }
  `;
  document.head.appendChild(style);
}
