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

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

export function showFilterDialog({ title, controls, initial = {}, onChange, onApply, onCancel }) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "m8-modal-overlay" });
    const dialog = el("div", { class: "m8-modal" });
    const heading = el("h2", { class: "m8-modal__title" }, title || "Filter");
    const form = el("form", { class: "m8-filter__form" });

    // Build controls
    const state = { ...initial };
    const fields = [];

    (controls || []).forEach((def) => {
      const id = def.id;
      const label = el("label", { for: id }, def.label || id);
      const wrap = el("div", { class: "m8-field" });
      let input = null;
      let output = null;
      const value = state[id] != null ? state[id] : def.value;
      if (def.type === "range") {
        input = el("input", {
          type: "range",
          id,
          min: String(def.min ?? 0),
          max: String(def.max ?? 100),
          step: String(def.step ?? 1),
          value: String(value ?? 0),
        });
        output = el("output", { id: `${id}__out` }, String(value));
        input.addEventListener("input", (e) => {
          const v = Number(e.target.value);
          state[id] = clamp(v, def.min ?? -Infinity, def.max ?? Infinity);
          output.textContent = def.format ? def.format(state[id]) : String(state[id]);
          if (typeof onChange === "function" && previewToggle.checked) {
            onChange({ ...state, live: true });
          }
        });
      } else if (def.type === "checkbox") {
        input = el("input", { type: "checkbox", id, checked: value ? "checked" : undefined });
        input.addEventListener("change", () => {
          state[id] = !!input.checked;
          if (typeof onChange === "function" && previewToggle.checked) {
            onChange({ ...state, live: true });
          }
        });
      }
      if (input) {
        wrap.appendChild(label);
        wrap.appendChild(input);
        if (output) wrap.appendChild(output);
        form.appendChild(wrap);
        fields.push({ id, input, output, def });
      }
    });

    const previewWrap = el("div", { class: "m8-field" });
    const previewLabel = el("label", { for: "m8-filter-preview" }, "Live Preview");
    const previewToggle = el("input", { type: "checkbox", id: "m8-filter-preview", checked: "checked" });
    previewWrap.appendChild(previewLabel);
    previewWrap.appendChild(previewToggle);
    form.appendChild(previewWrap);

    const actions = el("div", { class: "m8-modal__actions" }, [
      el("button", { type: "button", class: "m8-btn", id: "m8-filter-cancel" }, "Cancel"),
      el("button", { type: "submit", class: "m8-btn m8-btn--primary" }, "Apply"),
    ]);

    form.appendChild(actions);

    dialog.appendChild(heading);
    dialog.appendChild(form);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    applyStyles();

    previewToggle.addEventListener("change", () => {
      if (previewToggle.checked) {
        if (typeof onChange === "function") onChange({ ...state, live: true });
      } else {
        if (typeof onChange === "function") onChange({ ...state, live: false });
      }
    });

    document.getElementById("m8-filter-cancel").addEventListener("click", () => {
      try { if (typeof onCancel === "function") onCancel(); } catch (_) {}
      overlay.remove();
      resolve({ cancelled: true });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await onApply({ ...state }); } catch (err) { console.error("Filter apply failed", err); }
      overlay.remove();
      resolve({ cancelled: false, values: { ...state } });
    });

    // Initial change to seed preview
    if (typeof onChange === "function") onChange({ ...state, live: true });
  });
}

function applyStyles() {
  if (document.getElementById("m8-filter-styles")) return;
  const style = document.createElement("style");
  style.id = "m8-filter-styles";
  style.textContent = `
  .m8-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; z-index: 1000; }
  .m8-modal { width: min(560px, 94vw); background: var(--color-surface-raised, #1e1e1e); color: var(--color-text-primary, #fff); border: 1px solid var(--color-border, rgba(255,255,255,0.12)); border-radius: 12px; box-shadow: var(--shadow-soft, 0 12px 48px rgba(0,0,0,0.4)); padding: 1rem 1.1rem; }
  .m8-modal__title { margin: 0 0 0.75rem 0; font-size: 1.1rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-secondary, #ddd); }
  .m8-filter__form { display: grid; gap: 0.6rem; }
  .m8-field { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0.5rem; }
  .m8-modal__actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem; }
  .m8-btn { padding: 0.55rem 1rem; border-radius: 999px; background: var(--color-surface-highlight, #2a2a2a); color: var(--color-text-secondary, #ddd); border: 1px solid var(--color-border, rgba(255,255,255,0.12)); }
  .m8-btn--primary { background: var(--color-accent-soft, rgba(96,178,255,0.16)); color: var(--color-text-primary, #fff); border-color: rgba(255,255,255,0.24); }
  input[type="range"] { width: 240px; }
  `;
  document.head.appendChild(style);
}
