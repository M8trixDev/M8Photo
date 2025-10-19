import { openExportDialog } from "../modules/io/importExport.js";
import { initMenuBar } from "../modules/ui/menu.js";

const QUICK_ACTIONS = [
  { label: "Export", icon: "⇣" },
  { label: "Share", icon: "⇪" },
  { label: "Compare", icon: "≍" },
];

const DENSITY_KEY = "m8photo.ui.density";

export function initToolbar(scope = document) {
  const toolbarEl = scope.querySelector("[data-toolbar]");

  if (!toolbarEl) {
    return;
  }

  toolbarEl.innerHTML = `
    <div class="toolbar__branding" role="presentation">
      <span class="toolbar__glyph" aria-hidden="true">M8</span>
      <span class="toolbar__title">M8Photo</span>
    </div>
    <nav class="toolbar__menus" data-menubar aria-label="Primary menu"></nav>
    <div class="toolbar__spacer" aria-hidden="true"></div>
    <div class="toolbar__actions" role="group" aria-label="Quick actions">
      ${renderQuickActions()}
      ${renderDensityToggle()}
    </div>
  `;

  // Build the accessible menubar
  initMenuBar(toolbarEl);

  // Apply persisted density mode
  applyDensity(getSavedDensity());

  bindToolbarInteractions(toolbarEl);
}

function renderQuickActions() {
  return QUICK_ACTIONS.map((action) => {
    const commandAttr = action.label === "Export" ? ' data-command="io.export"' : "";
    return `
      <button class="toolbar__action" type="button"${commandAttr}>
        <span class="toolbar__action-icon" aria-hidden="true">${action.icon}</span>
        <span class="toolbar__action-label">${action.label}</span>
      </button>
    `;
  }).join("");
}

function renderDensityToggle() {
  const compact = getSavedDensity() === "compact";
  return `
    <button class="toolbar__action" type="button" data-density-toggle aria-pressed="${compact ? "true" : "false"}" title="Toggle compact density">
      <span class="toolbar__action-icon" aria-hidden="true">▣</span>
      <span class="toolbar__action-label">${compact ? "Compact" : "Comfort"}</span>
    </button>
  `;
}

function getSavedDensity() {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    if (v === "compact" || v === "comfort") return v;
  } catch (_) {}
  return "compact"; // default to compact for desktop feel
}

function applyDensity(mode) {
  const m = mode === "comfort" ? "comfort" : "compact";
  const root = document.documentElement || document.body;
  if (root) {
    root.setAttribute("data-density", m);
  }
}

function bindToolbarInteractions(toolbarEl) {
  const exportButtons = toolbarEl.querySelectorAll('[data-command="io.export"]');
  exportButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      try {
        openExportDialog();
      } catch (e) {
        console.warn("Export dialog failed", e);
      }
    });
  });

  const densityBtn = toolbarEl.querySelector("[data-density-toggle]");
  if (densityBtn) {
    densityBtn.addEventListener("click", () => {
      const current = getSavedDensity();
      const next = current === "compact" ? "comfort" : "compact";
      try { localStorage.setItem(DENSITY_KEY, next); } catch (_) {}
      applyDensity(next);
      densityBtn.setAttribute("aria-pressed", String(next === "compact"));
      const label = densityBtn.querySelector(".toolbar__action-label");
      if (label) label.textContent = next === "compact" ? "Compact" : "Comfort";
    });
  }
}
