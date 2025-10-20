import { tools } from "../modules/tools/index.js";
import { eventBus } from "../modules/core/events.js";
import { store } from "../modules/core/store.js";
import { getShortcutMap } from "./shortcuts.js";

const TOOL_DESCRIPTORS = [
  { id: "move", label: "Move (V)", icon: "↔", key: "v" },
  { id: "select", label: "Marquee (M)", icon: "□", key: "m", meta: { mode: "rect" } },
  { id: "select-lasso", label: "Lasso (L)", icon: "∿", key: "l", meta: { mode: "lasso" } },
  { id: "crop", label: "Crop (C)", icon: "✂", key: "c" },
  { id: "brush", label: "Brush (B)", icon: "✎", key: "b" },
  { id: "eraser", label: "Eraser (E)", icon: "⨂", key: "e" },
  { id: "fill", label: "Fill (G)", icon: "◼", key: "g" },
  { id: "text", label: "Text (T)", icon: "T", key: "t" },
  { id: "shape", label: "Shape (U)", icon: "⬚", key: "u" },
  { id: "eyedropper", label: "Eyedropper (I)", icon: "⦿", key: "i" },
  { id: "hand", label: "Hand (H)", icon: "✋", key: "h" },
  { id: "zoom", label: "Zoom (Z)", icon: "🔍", key: "z" },
];

function resolveToolId(id) {
  if (id === "select-lasso") return "select";
  return id;
}

function applyToolMeta(toolId, meta) {
  if (toolId === "select" && meta && meta.mode) {
    try {
      const current = store.getState().tools?.options?.select || {};
      const next = { ...current, lassoMode: meta.mode };
      tools.updateOptions("select", next, { source: "palette" });
    } catch (_) {}
  }
}

function renderButton(desc, active) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tool-btn";
  btn.setAttribute("data-tool", desc.id);
  btn.setAttribute("title", desc.label);
  btn.setAttribute("data-tip", desc.label);
  btn.setAttribute("aria-pressed", String(Boolean(active)));
  const span = document.createElement("span");
  span.className = "tool-btn__icon";
  span.setAttribute("aria-hidden", "true");
  span.textContent = desc.icon;
  btn.appendChild(span);
  const map = getShortcutMap();
  const key = Object.entries(map).find(([, v]) => (v || "").toLowerCase() === (desc.key || "").toLowerCase());
  const hint = key ? key[0] : desc.key;
  if (hint) {
    const kbd = document.createElement("kbd");
    kbd.className = "tool-kbd";
    kbd.textContent = String(hint).toUpperCase();
    btn.appendChild(kbd);
  }
  btn.addEventListener("click", () => {
    const targetId = resolveToolId(desc.id);
    tools.setActive(targetId, { source: "palette" });
    applyToolMeta(targetId, desc.meta);
  });
  return btn;
}

export function initToolPalette(scope = document) {
  const stage = scope.querySelector("[data-viewport-stage]");
  if (!stage) return;
  let container = stage.querySelector("[data-tool-palette]");
  if (!container) {
    container = document.createElement("div");
    container.className = "tool-palette";
    container.setAttribute("data-tool-palette", "");
    stage.appendChild(container);
  }
  const active = store.getState().tools?.active || "pointer";
  container.innerHTML = "";
  TOOL_DESCRIPTORS.forEach((d) => {
    container.appendChild(renderButton(d, resolveToolId(d.id) === active));
  });

  const detach = eventBus.on("tools:change", (ev) => {
    const nextTool = ev?.detail?.tool;
    container.querySelectorAll(".tool-btn").forEach((btn) => {
      const id = resolveToolId(btn.getAttribute("data-tool"));
      const isActive = id === nextTool;
      btn.setAttribute("aria-pressed", String(isActive));
      btn.classList.toggle("is-active", isActive);
    });
  });

  // Re-render when shortcuts mapping changes
  window.addEventListener("m8:shortcuts:updated", () => initToolPalette(scope), { passive: true });

  return () => { try { if (typeof detach === 'function') detach(); } catch (_) {} };
}
