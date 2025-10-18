import { store, DEFAULT_VIEWPORT_GRID } from "../modules/core/store.js";
import { eventBus } from "../modules/core/events.js";
import { openImportDialog, openExportDialog } from "../modules/io/importExport.js";

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

  bindToolbarInteractions(toolbarEl);
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
          <ul class="toolbar__menu-list" role="none">
            ${menu.items
              .map((item, itemIndex) => renderMenuItem(item, id, index, itemIndex))
              .join("")}
          </ul>
        </div>
      </section>
    `;
  }).join("");
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

function renderMenuItem(item, _menuId, _menuIndex, _itemIndex) {
  const descriptor = typeof item === "string" ? { label: item } : item || {};
  const label = descriptor.label || String(item);
  let command = descriptor.command || null;
  if (!command) {
    if (label === "Grid Overlay") command = "viewport.toggleGrid";
    if (label === "Import Assets") command = "io.import";
    if (label === "Save As…") command = "io.export";
  }
  const role = command === "viewport.toggleGrid" ? "menuitemcheckbox" : "menuitem";

  let stateAttr = "";
  let checkedAttr = "";
  if (command === "viewport.toggleGrid") {
    const currentGrid = store.getState().viewport?.grid;
    const visible = currentGrid ? currentGrid.visible !== false : true;
    stateAttr = ` data-state="${visible ? "on" : "off"}"`;
    checkedAttr = ` aria-checked="${visible ? "true" : "false"}"`;
  }

  const commandAttr = command ? ` data-command="${command}"` : "";
  const toggleAttr = command === "viewport.toggleGrid" ? " data-toolbar-grid-toggle" : "";
  const indicator = command === "viewport.toggleGrid" ? '<span class="toolbar__menu-indicator" aria-hidden="true">✓</span>' : "";

  return `
    <li class="toolbar__menu-item" role="none">
      <button
        type="button"
        class="toolbar__menu-action"
        role="${role}"
        ${commandAttr}${toggleAttr}${stateAttr}${checkedAttr}
      >
        <span class="toolbar__menu-label">${label}</span>
        ${indicator}
      </button>
    </li>
  `;
}

function bindToolbarInteractions(toolbarEl) {
  const gridToggle = toolbarEl.querySelector("[data-toolbar-grid-toggle]");

  if (gridToggle) {
    gridToggle.addEventListener("click", () => {
      toggleGridOverlay();
    });

    const unsubscribe = store.subscribe(
      (grid) => {
        updateGridButton(gridToggle, grid);
      },
      {
        selector: (state) => state.viewport.grid,
        equality: Object.is,
        fireImmediately: true,
      }
    );

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener(
        "beforeunload",
        () => {
          if (typeof unsubscribe === "function") {
            unsubscribe();
          }
        },
        { once: true }
      );
    }
  }

  // IO: Import / Export actions
  const importButtons = toolbarEl.querySelectorAll('[data-command="io.import"]');
  importButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      try {
        openImportDialog();
      } catch (e) {
        console.warn("Import dialog failed", e);
      }
    });
  });

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

function toggleGridOverlay() {
  const currentState = store.getState();
  const grid = currentState.viewport?.grid || DEFAULT_VIEWPORT_GRID;
  const nextVisible = grid.visible === false;

  store.updateSlice(
    "viewport",
    (viewport) => ({
      ...viewport,
      grid: { ...DEFAULT_VIEWPORT_GRID, ...viewport.grid, visible: nextVisible },
    }),
    { reason: "viewport:grid-toggle", source: "toolbar" }
  );

  if (eventBus) {
    eventBus.emit("viewport:grid-toggle", {
      visible: nextVisible,
      source: "toolbar",
    });
  }
}

function updateGridButton(button, gridState) {
  if (!button) {
    return;
  }

  const visible = gridState ? gridState.visible !== false : true;
  button.dataset.state = visible ? "on" : "off";
  button.setAttribute("aria-checked", String(visible));
  button.classList.toggle("is-active", visible);
}
