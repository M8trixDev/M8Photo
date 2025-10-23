import { openExportDialog } from "../modules/io/importExport.js";
import { openShortcutsEditor } from "./shortcutsEditor.js";

const QUICK_ACTIONS = [
  { label: "Export", icon: "⇣", title: "Export image" },
  { label: "Command", icon: "⌘", command: "ui.commandPalette", title: "Open command palette" },
  { label: "Shortcuts", icon: "⌨", command: "ui.shortcuts", title: "Edit shortcuts" },
  { label: "Density", icon: "◻", togglesDensity: true, title: "Toggle compact density" },
];

const DENSITY_KEY = "m8photo.ui.density";

export function initToolbar(scope = document) {
  const toolbarEl = scope.querySelector("[data-toolbar]");

  if (!toolbarEl) {
    return;
  }

  // Left toolbar is now vertical tool palette only
  toolbarEl.innerHTML = `
    <div class="toolbar__branding" role="presentation">
      <span class="toolbar__glyph" aria-hidden="true" title="M8Photo Studio">M8</span>
    </div>
    <div class="toolbar__tools" data-tool-palette-host aria-label="Tools"></div>
    <div class="toolbar__bottom">
      ${renderQuickActions()}
    </div>
  `;

  // Apply persisted density mode
  applyDensity(getSavedDensity());

  bindToolbarInteractions(toolbarEl);
}

function renderQuickActions() {
  return QUICK_ACTIONS.map((action) => {
    let commandAttr = "";
    if (action.label === "Export") commandAttr = ' data-command="io.export"';
    if (action.command) commandAttr = ` data-command="${action.command}"`;
    if (action.togglesDensity) commandAttr = ' data-density-toggle';
    const compact = getSavedDensity() === "compact";
    const pressed = action.togglesDensity ? ` aria-pressed="${compact ? "true" : "false"}"` : '';
    return `
      <button class="toolbar__action" type="button"${commandAttr}${pressed} title="${action.title || action.label}" aria-label="${action.label}">
        <span class="toolbar__action-icon" aria-hidden="true">${action.icon}</span>
      </button>
    `;
  }).join("");
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
  const html = document.documentElement;
  const body = document.body;
  if (html) {
    html.setAttribute("data-density", m);
  }
  if (body) {
    body.setAttribute("data-density", m);
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
      const title = next === "compact" ? "Toggle compact density" : "Toggle comfort density";
      densityBtn.setAttribute("title", title);
      densityBtn.setAttribute("aria-label", next === "compact" ? "Compact density" : "Comfort density");
    });
  }

  // Extra quick actions
  const cmdBtn = toolbarEl.querySelector('[data-command="ui.commandPalette"]');
  cmdBtn?.addEventListener('click', ()=> { try { window.M8PhotoCmdk && window.M8PhotoCmdk.open(); } catch (_) {} });
  const scBtn = toolbarEl.querySelector('[data-command="ui.shortcuts"]');
  scBtn?.addEventListener('click', ()=> { try { openShortcutsEditor(); } catch (_) {} });
}
