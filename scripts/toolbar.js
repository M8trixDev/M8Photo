import { openExportDialog } from "../modules/io/importExport.js";
import { initMenuBar } from "../modules/ui/menu.js";

const QUICK_ACTIONS = [
  { label: "Export", icon: "⇣" },
  { label: "Share", icon: "⇪" },
  { label: "Compare", icon: "≍" },
];

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
    </div>
  `;

  // Build the accessible menubar
  initMenuBar(toolbarEl);

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
}
