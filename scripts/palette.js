import { tools } from "../modules/tools/index.js";
import { eventBus } from "../modules/core/events.js";
import { store } from "../modules/core/store.js";
import { getShortcutMap } from "./shortcuts.js";

const TOOL_DESCRIPTORS = [
  { id: "move", label: "Move (V)", icon: "assets/icons/tool-move.svg", key: "v" },
  { id: "select", label: "Marquee (M)", icon: "assets/icons/tool-marquee.svg", key: "m", meta: { mode: "rect" } },
  { id: "select-lasso", label: "Lasso (L)", icon: "assets/icons/tool-lasso.svg", key: "l", meta: { mode: "lasso" } },
  { id: "crop", label: "Crop (C)", icon: "assets/icons/tool-crop.svg", key: "c" },
  { id: "brush", label: "Brush (B)", icon: "assets/icons/tool-brush.svg", key: "b" },
  { id: "eraser", label: "Eraser (E)", icon: "assets/icons/tool-eraser.svg", key: "e" },
  { id: "fill", label: "Fill (G)", icon: "assets/icons/tool-fill.svg", key: "g" },
  { id: "text", label: "Text (T)", icon: "assets/icons/tool-text.svg", key: "t" },
  { id: "shape", label: "Shape (U)", icon: "assets/icons/tool-shape.svg", key: "u" },
  { id: "eyedropper", label: "Eyedropper (I)", icon: "assets/icons/tool-eyedropper.svg", key: "i" },
  { id: "hand", label: "Hand (H)", icon: "assets/icons/tool-hand.svg", key: "h" },
  { id: "zoom", label: "Zoom (Z)", icon: "assets/icons/tool-zoom.svg", key: "z" },
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
  btn.setAttribute("aria-label", desc.label);
  btn.setAttribute("aria-pressed", String(Boolean(active)));

  const map = getShortcutMap();
  const keyEntry = Object.entries(map).find(([, v]) => (v || "").toLowerCase() === (desc.key || "").toLowerCase());
  const hint = keyEntry ? keyEntry[0] : desc.key;
  if (hint) {
    btn.setAttribute("aria-keyshortcuts", String(hint).toUpperCase());
  }

  const span = document.createElement("span");
  span.className = "tool-btn__icon";
  span.setAttribute("aria-hidden", "true");
  // Use CSS mask so icon adopts currentColor for hover/active states
  span.style.width = "20px";
  span.style.height = "20px";
  span.style.display = "inline-block";
  span.style.backgroundColor = "currentColor";
  span.style.maskImage = `url(${desc.icon})`;
  span.style.webkitMaskImage = `url(${desc.icon})`;
  span.style.maskRepeat = "no-repeat";
  span.style.webkitMaskRepeat = "no-repeat";
  span.style.maskPosition = "center";
  span.style.webkitMaskPosition = "center";
  span.style.maskSize = "contain";
  span.style.webkitMaskSize = "contain";
  btn.appendChild(span);

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

  // Placeholder for future subtool flyouts: right-click or long-press
  const showSubtools = (ev) => {
    try { ev.preventDefault(); } catch (_) {}
    const pop = document.createElement("div");
    pop.className = "tool-subtools-popover";
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", `${desc.label} subtools`);
    pop.textContent = "Subtools coming soon";
    document.body.appendChild(pop);
    const rect = btn.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = `${Math.round(rect.top)}px`;
    pop.style.left = `${Math.round(rect.right + 8)}px`;
    const cleanup = () => { try { document.body.removeChild(pop); } catch (_) {} window.removeEventListener("pointerdown", cleanup, { capture: true }); };
    window.addEventListener("pointerdown", cleanup, { capture: true, once: true });
    setTimeout(cleanup, 1200);
  };
  btn.addEventListener("contextmenu", showSubtools);

  let longPressTimer = null;
  btn.addEventListener("pointerdown", () => {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => showSubtools(new Event("custom")), 550);
  });
  const clearLp = () => { clearTimeout(longPressTimer); };
  ["pointerup", "pointerleave", "pointercancel", "dragstart"].forEach((t) => btn.addEventListener(t, clearLp));

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
    container.setAttribute("role", "toolbar");
    container.setAttribute("aria-orientation", "vertical");
    container.setAttribute("aria-label", "Tools");
    stage.appendChild(container);
  } else {
    // Ensure ARIA roles are present if palette already exists
    container.setAttribute("role", "toolbar");
    container.setAttribute("aria-orientation", "vertical");
    container.setAttribute("aria-label", "Tools");
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
