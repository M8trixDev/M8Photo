import { getTemplates, createProjectFromTemplate } from "../../io/templates.js";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (key === "class") {
      node.className = String(value || "");
    } else if (key === "style" && value && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
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

export function showTemplatesDialog(options = {}) {
  const templates = Array.isArray(options.templates) && options.templates.length ? options.templates : getTemplates();

  return new Promise((resolve) => {
    const overlay = el("div", { class: "m8-modal-overlay" });
    const dialog = el("div", { class: "m8-modal m8-templates" });
    const title = el("h2", { class: "m8-modal__title" }, "New Project");
    const desc = el("p", { class: "m8-modal__desc" }, "Choose a template to start with preset dimensions.");

    const grid = el("div", { class: "m8-templates__grid", role: "list" });

    templates.forEach((tpl) => {
      const item = el("button", {
        type: "button",
        class: "m8-templates__item",
        role: "listitem",
        "data-id": tpl.id,
        onClick: () => selectTemplate(tpl),
      });

      const thumb = el("img", {
        class: "m8-templates__thumb",
        src: tpl.thumb,
        alt: `${tpl.name} preview`,
        loading: "eager",
        decoding: "async",
        width: "160",
        height: "90",
      });

      const name = el("div", { class: "m8-templates__name" }, tpl.name);
      const meta = el("div", { class: "m8-templates__meta" }, tpl.description || `${tpl.width} × ${tpl.height} px`);

      item.appendChild(thumb);
      item.appendChild(name);
      item.appendChild(meta);
      grid.appendChild(item);
    });

    const actions = el("div", { class: "m8-modal__actions" }, [
      el("button", { type: "button", class: "m8-btn", onClick: () => close(null) }, "Cancel"),
    ]);

    dialog.appendChild(title);
    dialog.appendChild(desc);
    dialog.appendChild(grid);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    applyStyles();

    function selectTemplate(tpl) {
      try {
        const result = createProjectFromTemplate(tpl);
        close({ cancelled: false, template: result.template });
      } catch (e) {
        console.error("Failed to create project from template", e);
        close({ cancelled: true, error: e });
      }
    }

    function close(result) {
      try { overlay.remove(); } catch (_) {}
      resolve(result || { cancelled: true });
    }
  });
}

function applyStyles() {
  if (document.getElementById("m8-templates-styles")) return;
  const style = document.createElement("style");
  style.id = "m8-templates-styles";
  style.textContent = `
  .m8-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; z-index: 1000; }
  .m8-modal { width: min(780px, 96vw); max-width: 780px; background: var(--color-surface-raised, #1e1e1e); color: var(--color-text-primary, #fff); border: 1px solid var(--color-border, rgba(255,255,255,0.12)); border-radius: 12px; box-shadow: var(--shadow-soft, 0 12px 48px rgba(0,0,0,0.4)); padding: 1rem 1.1rem; }
  .m8-modal__title { margin: 0 0 0.25rem 0; font-size: 1.1rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-secondary, #ddd); }
  .m8-modal__desc { margin: 0 0 0.75rem 0; color: var(--color-text-muted, #aaa); font-size: 0.95rem; }
  .m8-templates__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); align-items: stretch; gap: 0.7rem; padding: 0.25rem 0.2rem 0.4rem; }
  .m8-templates__item { display: grid; grid-template-rows: auto auto auto; gap: 0.35rem; text-align: left; padding: 0.6rem; border-radius: 10px; background: var(--color-surface-highlight, #2a2a2a); border: 1px solid var(--color-border, rgba(255,255,255,0.12)); color: inherit; cursor: pointer; }
  .m8-templates__item:hover, .m8-templates__item:focus { outline: none; border-color: rgba(255,255,255,0.24); background: rgba(255,255,255,0.06); }
  .m8-templates__thumb { width: 100%; height: 120px; object-fit: contain; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; filter: grayscale(100%) contrast(1.05); }
  .m8-templates__name { font-weight: 600; font-size: 0.95rem; color: var(--color-text-primary, #fff); }
  .m8-templates__meta { font-size: 0.85rem; color: var(--color-text-muted, #aaa); }
  .m8-modal__actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem; }
  .m8-btn { padding: 0.55rem 1rem; border-radius: 999px; background: var(--color-surface-highlight, #2a2a2a); color: var(--color-text-secondary, #ddd); border: 1px solid var(--color-border, rgba(255,255,255,0.12)); }
  `;
  document.head.appendChild(style);
}

export default { showTemplatesDialog };
