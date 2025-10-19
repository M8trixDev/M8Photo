import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { tools } from "../tools/index.js";
import { openImportDialog, openExportDialog } from "../io/importExport.js";
import { layerManager } from "../layers/layerManager.js";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function createEl(tag, attrs = {}, html) {
  const el = document.createElement(tag);
  Object.keys(attrs || {}).forEach((key) => {
    if (key === "class") {
      el.className = attrs[key];
      return;
    }
    if (key.startsWith("on") && typeof attrs[key] === "function") {
      el.addEventListener(key.substring(2).toLowerCase(), attrs[key]);
      return;
    }
    if (attrs[key] === false || attrs[key] === null || attrs[key] === undefined) {
      return;
    }
    el.setAttribute(key, String(attrs[key]));
  });
  if (html !== undefined) {
    el.innerHTML = String(html);
  }
  return el;
}

function buildShortcutLabel(shortcut) {
  if (!shortcut) return "";
  return shortcut
    .replace(/Mod/gi, MOD)
    .replace(/Shift\+/g, "⇧ ")
    .replace(/Alt\+/g, isMac ? "⌥ " : "Alt+")
    .replace(/Ctrl\+/g, isMac ? "^ " : "Ctrl+")
    .replace(/\+/g, " ");
}

function isInputLike(target) {
  const el = target;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  const editable = el.getAttribute("contenteditable");
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (editable && editable !== "false") ||
    el.closest("[contenteditable=true]")
  );
}

function clampUnit(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function getActiveLayerId() {
  const state = store.getState();
  return state.layers?.active || null;
}

function getHistoryState() {
  const state = store.getState();
  const h = state.history || {};
  return { canUndo: !!h.canUndo, canRedo: !!h.canRedo };
}

function getGridVisible() {
  const grid = store.getState().viewport?.grid;
  return grid ? grid.visible !== false : true;
}

function toggleGridOverlay() {
  const current = store.getState().viewport?.grid || {};
  const nextVisible = current.visible === false;
  store.updateSlice(
    "viewport",
    (viewport) => ({
      ...viewport,
      grid: { ...viewport.grid, visible: nextVisible },
    }),
    { reason: "viewport:grid-toggle", source: "menu" }
  );
  if (eventBus) eventBus.emit("viewport:grid-toggle", { visible: nextVisible, source: "menu" });
}

function setLayerOpacity(percent) {
  const id = getActiveLayerId();
  if (!id) return;
  const value = clampUnit(percent / 100);
  layerManager.updateLayer(id, { opacity: value }, { source: "menu" });
}

function exec(command) {
  switch (command) {
    case "file:new": {
      // Open templates dialog for new project
      import("./dialogs/templatesDialog.js")
        .then((module) => (module && typeof module.showTemplatesDialog === "function" ? module.showTemplatesDialog() : null))
        .catch(() => {});
      break;
    }
    case "file:open": {
      openImportDialog({ mode: "new-project" }).catch(() => {});
      break;
    }
    case "file:save": {
      openExportDialog().catch(() => {});
      break;
    }
    case "edit:undo": {
      history.undo();
      break;
    }
    case "edit:redo": {
      history.redo();
      break;
    }
    case "layer:new": {
      layerManager.createLayer({ name: "Layer" }, { source: "menu", setActive: true, updateSelection: true });
      break;
    }
    case "layer:duplicate": {
      const id = getActiveLayerId();
      if (id) layerManager.duplicateLayer(id, { source: "menu", setActive: true, updateSelection: true });
      break;
    }
    case "layer:delete": {
      const id = getActiveLayerId();
      if (id) layerManager.removeLayer(id, { source: "menu", updateSelection: true });
      break;
    }
    case "filter:brightnessContrast":
    case "filter:saturationHue":
    case "filter:grayscale":
    case "filter:blur":
    case "filter:invert": {
      if (eventBus) eventBus.emit("filter:apply", { type: command.split(":")[1] });
      break;
    }
    case "view:zoomIn": {
      const vp = store.getState().viewport || {};
      const next = (vp.zoom ?? 1) * 1.1;
      store.updateSlice(
        "viewport",
        (viewport) => ({ ...viewport, zoom: next }),
        { reason: "viewport:zoom-in", source: "menu" }
      );
      if (eventBus) eventBus.emit("viewport:zoom", { zoom: next, source: "menu" });
      break;
    }
    case "view:zoomOut": {
      const vp = store.getState().viewport || {};
      const next = (vp.zoom ?? 1) / 1.1;
      store.updateSlice(
        "viewport",
        (viewport) => ({ ...viewport, zoom: next }),
        { reason: "viewport:zoom-out", source: "menu" }
      );
      if (eventBus) eventBus.emit("viewport:zoom", { zoom: next, source: "menu" });
      break;
    }
    case "view:resetZoom": {
      store.updateSlice(
        "viewport",
        (viewport) => ({ ...viewport, zoom: 1, pan: { x: 0, y: 0 } }),
        { reason: "viewport:reset", source: "menu" }
      );
      if (eventBus) eventBus.emit("viewport:reset", { zoom: 1, source: "menu" });
      break;
    }
    case "view:toggleGrid": {
      toggleGridOverlay();
      break;
    }
    case "tool:move": {
      tools.setActive("move", { source: "menu" });
      break;
    }
    case "tool:brush": {
      tools.setActive("brush", { source: "menu" });
      break;
    }
    case "tool:eraser": {
      tools.setActive("eraser", { source: "menu" });
      break;
    }
    case "tool:text": {
      tools.setActive("text", { source: "menu" });
      break;
    }
    case "tool:crop": {
      tools.setActive("crop", { source: "menu" });
      break;
    }
    case "tool:select": {
      tools.setActive("select", { source: "menu" });
      break;
    }
    case "crop:apply": {
      const crop = tools.getTool("crop");
      if (crop && typeof crop.apply === "function") crop.apply();
      break;
    }
    case "crop:cancel": {
      const crop = tools.getTool("crop");
      if (crop && typeof crop.cancel === "function") crop.cancel();
      break;
    }
    case "select:all": {
      const vp = store.getState().viewport?.size || { width: 0, height: 0 };
      const select = tools.getTool("select");
      if (select && typeof select.applyRect === "function") {
        select.applyRect({ x: 0, y: 0, width: Math.max(1, vp.width || 0), height: Math.max(1, vp.height || 0) }, "replace");
      }
      break;
    }
    case "select:none": {
      const select = tools.getTool("select");
      if (select && typeof select.deselect === "function") select.deselect();
      break;
    }
    case "select:clear": {
      const select = tools.getTool("select");
      if (select && typeof select.clear === "function") select.clear();
      break;
    }
    case "select:fill": {
      const select = tools.getTool("select");
      if (select && typeof select.fill === "function") select.fill();
      break;
    }
    default: {
      if (eventBus) eventBus.emit("command:execute", { command });
      break;
    }
  }
}

const MENU_MODEL = [
  {
    id: "file",
    label: "File",
    items: [
      { id: "file:new", label: "New Project…", shortcut: `Mod+N` },
      { id: "file:open", label: "Open…", shortcut: `Mod+O` },
      { type: "separator" },
      { id: "file:save", label: "Save As…", shortcut: `Mod+Shift+S` },
      { id: "io:import", label: "Import Assets…" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      { id: "edit:undo", label: "Undo", shortcut: `Mod+Z`, enabled: () => getHistoryState().canUndo },
      { id: "edit:redo", label: "Redo", shortcut: isMac ? `Mod+Shift+Z` : `Mod+Y`, enabled: () => getHistoryState().canRedo },
      { type: "separator" },
      { id: "edit:cut", label: "Cut", shortcut: `Mod+X`, action: () => document.execCommand && document.execCommand("cut") },
      { id: "edit:copy", label: "Copy", shortcut: `Mod+C`, action: () => document.execCommand && document.execCommand("copy") },
      { id: "edit:paste", label: "Paste", shortcut: `Mod+V`, action: () => document.execCommand && document.execCommand("paste") },
    ],
  },
  {
    id: "layer",
    label: "Layer",
    items: [
      { id: "layer:new", label: "New Layer", shortcut: `Shift+Mod+N` },
      { id: "layer:duplicate", label: "Duplicate Layer", shortcut: `Mod+J` },
      { id: "layer:delete", label: "Delete Layer", shortcut: `Delete` },
      { type: "separator" },
      { id: "layer:opacity:10", label: "Opacity 10%", shortcut: `1`, action: () => setLayerOpacity(10) },
      { id: "layer:opacity:50", label: "Opacity 50%", shortcut: `5`, action: () => setLayerOpacity(50) },
      { id: "layer:opacity:100", label: "Opacity 100%", shortcut: `0`, action: () => setLayerOpacity(100) },
    ],
  },
  {
    id: "filter",
    label: "Filter",
    items: [
      { id: "filter:brightnessContrast", label: "Brightness / Contrast", shortcut: `Mod+Shift+B` },
      { id: "filter:saturationHue", label: "Saturation / Hue", shortcut: `Mod+U` },
      { id: "filter:grayscale", label: "Grayscale", shortcut: `Mod+Shift+G` },
      { type: "separator" },
      { id: "filter:invert", label: "Invert", shortcut: `Mod+I` },
      { id: "filter:blur", label: "Gaussian Blur", shortcut: `Mod+Alt+B` },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      { id: "view:zoomIn", label: "Zoom In", shortcut: `Mod+=` },
      { id: "view:zoomOut", label: "Zoom Out", shortcut: `Mod+-` },
      { id: "view:resetZoom", label: "Actual Size", shortcut: `Mod+0` },
      { type: "separator" },
      { id: "view:toggleGrid", label: "Grid Overlay", role: "menuitemcheckbox", getChecked: () => getGridVisible() },
    ],
  },
  {
    id: "image",
    label: "Image",
    items: [
      { id: "tool:crop", label: "Crop Tool" },
      { id: "crop:apply", label: "Apply Crop", enabled: () => {
        const active = store.getState().tools?.active === "crop";
        const crop = tools.getTool("crop");
        const canApply = crop && typeof crop.hasSelection === "function" ? crop.hasSelection() : false;
        return active && canApply;
      } },
      { id: "crop:cancel", label: "Cancel Crop", enabled: () => store.getState().tools?.active === "crop" },
    ],
  },
  {
    id: "select",
    label: "Select",
    items: [
      { id: "tool:select", label: "Selection Tool" },
      { id: "select:all", label: "Select All", shortcut: `Mod+A` },
      { id: "select:none", label: "Deselect", shortcut: `Mod+D` },
      { type: "separator" },
      { id: "select:clear", label: "Clear Selection", shortcut: `Shift+Delete`, enabled: () => Boolean(store.getState().selection?.region) },
      { id: "select:fill", label: "Fill Selection", shortcut: `Shift+F5`, enabled: () => Boolean(store.getState().selection?.region) },
    ],
  },
];

function renderMenuItem(descriptor) {
  if (!descriptor || descriptor.type === "separator") {
    const li = createEl("li", { class: "toolbar__menu-item", role: "none" });
    const hr = createEl("div", { class: "toolbar__menu-separator", role: "separator" });
    li.appendChild(hr);
    return li;
  }

  const role = descriptor.role || "menuitem";
  const li = createEl("li", { class: "toolbar__menu-item", role: "none" });

  const attrs = {
    type: "button",
    class: "toolbar__menu-action",
    role,
    "data-command": descriptor.id,
    "aria-disabled": "false",
  };

  if (role === "menuitemcheckbox") {
    attrs["aria-checked"] = String(Boolean(descriptor.getChecked ? descriptor.getChecked() : false));
  }

  const btn = createEl("button", attrs);
  const label = createEl("span", { class: "toolbar__menu-label" }, descriptor.label || descriptor.id);
  btn.appendChild(label);

  if (descriptor.shortcut) {
    const hint = createEl("span", { class: "toolbar__menu-indicator" }, buildShortcutLabel(descriptor.shortcut));
    btn.appendChild(hint);
  }

  if (typeof descriptor.enabled === "function" && !descriptor.enabled()) {
    btn.setAttribute("aria-disabled", "true");
    btn.disabled = true;
  }

  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;

    if (descriptor.role === "menuitemcheckbox") {
      toggleGridOverlay();
      btn.setAttribute("aria-checked", String(getGridVisible()));
    } else if (typeof descriptor.action === "function") {
      descriptor.action();
    } else if (descriptor.id === "io:import") {
      openImportDialog().catch(() => {});
    } else if (descriptor.id) {
      exec(descriptor.id);
    }
    closeAllMenus(btn.closest("[data-menubar]") || document);
  });

  li.appendChild(btn);
  return li;
}

function closeAllMenus(scope = document) {
  const openMenus = scope.querySelectorAll(".toolbar__menu:not(.is-collapsed)");
  openMenus.forEach((menu) => {
    menu.classList.add("is-collapsed");
    const trigger = menu.querySelector(".toolbar__menu-trigger");
    const content = menu.querySelector(".toolbar__menu-content");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (content) content.hidden = true;
  });
}

function openMenuSection(section) {
  if (!section) return;
  const trigger = section.querySelector(".toolbar__menu-trigger");
  const content = section.querySelector(".toolbar__menu-content");
  section.classList.remove("is-collapsed");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  if (content) content.hidden = false;
}

function moveFocus(list, current, delta) {
  const items = Array.from(list.querySelectorAll(".toolbar__menu-action:not([disabled])"));
  if (!items.length) return;
  let index = items.indexOf(current);
  if (index < 0) index = 0;
  index = (index + delta + items.length) % items.length;
  items[index].focus();
}

function renderMenuSection(menu) {
  const section = createEl("section", { class: "toolbar__menu is-collapsed", "data-menu-id": menu.id });
  const trigger = createEl(
    "button",
    {
      type: "button",
      class: "toolbar__menu-button toolbar__menu-trigger",
      id: `menu-${menu.id}-toggle`,
      role: "menuitem",
      "aria-haspopup": "true",
      "aria-expanded": "false",
    },
    menu.label
  );
  const content = createEl("div", {
    class: "toolbar__menu-content",
    id: `menu-${menu.id}-content`,
    role: "menu",
    hidden: true,
  });
  const list = createEl("ul", { class: "toolbar__menu-list", role: "none" });
  (menu.items || []).forEach((item) => list.appendChild(renderMenuItem(item)));
  content.appendChild(list);

  trigger.addEventListener("click", (e) => {
    const isOpen = !section.classList.contains("is-collapsed");
    closeAllMenus(section.parentElement || document);
    if (!isOpen) {
      openMenuSection(section);
      // Focus first item
      const first = content.querySelector(".toolbar__menu-action:not([disabled])");
      if (first) first.focus();
    }
  });

  // Hover to switch menus when one is already open
  trigger.addEventListener("mouseenter", () => {
    const parent = section.parentElement;
    if (!parent) return;
    const anyOpen = parent.querySelector(".toolbar__menu:not(.is-collapsed)");
    if (anyOpen && section.classList.contains("is-collapsed")) {
      closeAllMenus(parent);
      openMenuSection(section);
    }
  });

  trigger.addEventListener("keydown", (e) => {
    const key = e.key;
    if (key === "ArrowDown" || key === "Down") {
      e.preventDefault();
      openMenuSection(section);
      const first = content.querySelector(".toolbar__menu-action:not([disabled])");
      if (first) first.focus();
      return;
    }
    if (key === "ArrowUp" || key === "Up") {
      e.preventDefault();
      openMenuSection(section);
      const items = content.querySelectorAll(".toolbar__menu-action:not([disabled])");
      if (items.length) items[items.length - 1].focus();
      return;
    }
  });

  content.addEventListener("keydown", (e) => {
    const key = e.key;
    const active = document.activeElement;
    if (key === "Escape" || key === "Esc") {
      e.preventDefault();
      section.classList.add("is-collapsed");
      trigger.setAttribute("aria-expanded", "false");
      content.hidden = true;
      trigger.focus();
      return;
    }
    if (key === "ArrowDown" || key === "Down") {
      e.preventDefault();
      moveFocus(content, active, 1);
      return;
    }
    if (key === "ArrowUp" || key === "Up") {
      e.preventDefault();
      moveFocus(content, active, -1);
      return;
    }
    if (key === "Home") {
      e.preventDefault();
      const first = content.querySelector(".toolbar__menu-action:not([disabled])");
      if (first) first.focus();
      return;
    }
    if (key === "End") {
      e.preventDefault();
      const items = content.querySelectorAll(".toolbar__menu-action:not([disabled])");
      if (items.length) items[items.length - 1].focus();
      return;
    }
    if (key === "ArrowLeft" || key === "Left" || key === "ArrowRight" || key === "Right") {
      // Switch to adjacent menu
      e.preventDefault();
      const parent = section.parentElement;
      const menus = Array.from(parent.querySelectorAll(".toolbar__menu"));
      const index = menus.indexOf(section);
      const nextIndex = key === "ArrowLeft" || key === "Left" ? (index - 1 + menus.length) % menus.length : (index + 1) % menus.length;
      closeAllMenus(parent);
      const nextSection = menus[nextIndex];
      openMenuSection(nextSection);
      const nextFirst = nextSection.querySelector(".toolbar__menu-action:not([disabled])");
      if (nextFirst) nextFirst.focus();
      return;
    }
    if (key === "Tab") {
      const items = Array.from(content.querySelectorAll(".toolbar__menu-action:not([disabled])"));
      if (!items.length) return;
      e.preventDefault();
      const activeIndex = items.indexOf(document.activeElement);
      let nextIndex = activeIndex;
      if (e.shiftKey) {
        nextIndex = (activeIndex - 1 + items.length) % items.length;
      } else {
        nextIndex = (activeIndex + 1) % items.length;
      }
      items[nextIndex].focus();
      return;
    }
  });

  section.appendChild(trigger);
  section.appendChild(content);
  return section;
}

function updateDynamicStates(scope = document) {
  // Undo / Redo
  const { canUndo, canRedo } = getHistoryState();
  const undoBtn = scope.querySelector('[data-command="edit:undo"]');
  const redoBtn = scope.querySelector('[data-command="edit:redo"]');
  if (undoBtn) {
    undoBtn.disabled = !canUndo;
    undoBtn.setAttribute("aria-disabled", String(!canUndo));
  }
  if (redoBtn) {
    redoBtn.disabled = !canRedo;
    redoBtn.setAttribute("aria-disabled", String(!canRedo));
  }
  // Grid toggle
  const gridBtn = scope.querySelector('[data-command="view:toggleGrid"]');
  if (gridBtn) {
    const visible = getGridVisible();
    gridBtn.setAttribute("aria-checked", String(visible));
    if (visible) {
      gridBtn.dataset.state = "on";
      gridBtn.classList.add("is-active");
    } else {
      gridBtn.dataset.state = "off";
      gridBtn.classList.remove("is-active");
    }
  }
  // Crop apply/cancel states
  const applyBtn = scope.querySelector('[data-command="crop:apply"]');
  if (applyBtn) {
    const active = store.getState().tools?.active === "crop";
    const crop = tools.getTool("crop");
    const canApply = crop && typeof crop.hasSelection === "function" ? crop.hasSelection() : false;
    const enabled = active && canApply;
    applyBtn.disabled = !enabled;
    applyBtn.setAttribute("aria-disabled", String(!enabled));
  }
  const cancelBtn = scope.querySelector('[data-command="crop:cancel"]');
  if (cancelBtn) {
    const enabled = store.getState().tools?.active === "crop";
    cancelBtn.disabled = !enabled;
    cancelBtn.setAttribute("aria-disabled", String(!enabled));
  }
  // Selection clear/fill availability
  const hasRegion = Boolean(store.getState().selection?.region);
  const clearBtn = scope.querySelector('[data-command="select:clear"]');
  if (clearBtn) {
    clearBtn.disabled = !hasRegion;
    clearBtn.setAttribute("aria-disabled", String(!hasRegion));
  }
  const fillBtn = scope.querySelector('[data-command="select:fill"]');
  if (fillBtn) {
    fillBtn.disabled = !hasRegion;
    fillBtn.setAttribute("aria-disabled", String(!hasRegion));
  }
}

export function initMenuBar(scope = document) {
  const container = scope.querySelector("[data-menubar]") || scope.querySelector("[data-toolbar] .toolbar__menus");

  if (!container) {
    return null;
  }

  container.setAttribute("role", "menubar");
  container.setAttribute("aria-label", "Primary menu");
  const menubar = container;
  menubar.innerHTML = "";

  MENU_MODEL.forEach((menu) => {
    menubar.appendChild(renderMenuSection(menu));
  });

  function handleOutsideClick(e) {
    if (!menubar.contains(e.target)) {
      closeAllMenus(menubar);
    }
  }

  function handleMenubarKeyNav(e) {
    const key = e.key;
    const triggers = Array.from(menubar.querySelectorAll(".toolbar__menu-trigger"));
    if (!triggers.length) return;
    const active = document.activeElement;
    const currentIndex = triggers.indexOf(active);
    if (key === "ArrowRight" || key === "Right") {
      e.preventDefault();
      const next = triggers[(Math.max(0, currentIndex) + 1) % triggers.length];
      next.focus();
    } else if (key === "ArrowLeft" || key === "Left") {
      e.preventDefault();
      const next = triggers[(currentIndex - 1 + triggers.length) % triggers.length];
      next.focus();
    }
  }

  document.addEventListener("click", handleOutsideClick);
  menubar.addEventListener("keydown", handleMenubarKeyNav);

  const unsubscribeHistory = store.subscribe(() => updateDynamicStates(menubar), {
    selector: (s) => s.history,
    equality: Object.is,
    fireImmediately: true,
  });
  const unsubscribeGrid = store.subscribe(() => updateDynamicStates(menubar), {
    selector: (s) => s.viewport?.grid,
    equality: Object.is,
    fireImmediately: true,
  });
  const unsubscribeTools = store.subscribe(() => updateDynamicStates(menubar), {
    selector: (s) => s.tools,
    equality: Object.is,
    fireImmediately: true,
  });

  window.addEventListener("beforeunload", () => {
    try { document.removeEventListener("click", handleOutsideClick); } catch (_) {}
    try { menubar.removeEventListener("keydown", handleMenubarKeyNav); } catch (_) {}
    try { if (typeof unsubscribeHistory === "function") unsubscribeHistory(); } catch (_) {}
    try { if (typeof unsubscribeGrid === "function") unsubscribeGrid(); } catch (_) {}
    try { if (typeof unsubscribeTools === "function") unsubscribeTools(); } catch (_) {}
  }, { once: true });

  updateDynamicStates(menubar);
  return menubar;
}

export default { initMenuBar };
