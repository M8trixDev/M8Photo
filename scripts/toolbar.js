const MENUS = [
  {
    label: "File",
    items: ["New Project", "Open…", "Save As…", "Import Assets"],
  },
  {
    label: "Edit",
    items: ["Undo", "Redo", "Transform", "Preferences"],
  },
  {
    label: "View",
    items: ["Toggle Panels", "Fullscreen", "Grid Overlay", "Soft Proof"],
  },
];

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
    <nav class="toolbar__menus" aria-label="Primary menu">
      ${renderMenus()}
    </nav>
    <div class="toolbar__spacer" aria-hidden="true"></div>
    <div class="toolbar__actions" role="group" aria-label="Quick actions">
      ${renderQuickActions()}
    </div>
  `;
}

function renderMenus() {
  return MENUS.map((menu, index) => {
    const id = `toolbar-menu-${index}`;
    return `
      <section class="toolbar__menu is-collapsed" data-collapsible>
        <button
          class="toolbar__menu-button"
          type="button"
          id="${id}-toggle"
          data-collapsible-toggle
          aria-controls="${id}-content"
        >
          ${menu.label}
        </button>
        <div
          class="toolbar__menu-content"
          id="${id}-content"
          role="menu"
          data-collapsible-content
        >
          <ul class="toolbar__menu-list">
            ${menu.items
              .map(
                (item) => `
                  <li class="toolbar__menu-item" role="menuitem">
                    <button type="button" class="toolbar__menu-action">${item}</button>
                  </li>
                `,
              )
              .join("")}
          </ul>
        </div>
      </section>
    `;
  }).join("");
}

function renderQuickActions() {
  return QUICK_ACTIONS.map(
    (action) => `
      <button class="toolbar__action" type="button">
        <span class="toolbar__action-icon" aria-hidden="true">${action.icon}</span>
        <span class="toolbar__action-label">${action.label}</span>
      </button>
    `,
  ).join("");
}
