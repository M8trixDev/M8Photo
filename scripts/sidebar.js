const STORAGE_WIDTH_KEY = "m8photo.sidebar.width";
const STORAGE_COLLAPSED_KEY = "m8photo.sidebar.collapsed";

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 260;
const MAX_WIDTH = 440;

function clampWidth(px) {
  const n = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(Number(px) || DEFAULT_WIDTH)));
  return n;
}

function readSavedWidth() {
  try {
    const v = localStorage.getItem(STORAGE_WIDTH_KEY);
    if (!v) return DEFAULT_WIDTH;
    const w = Number(v);
    if (!Number.isFinite(w)) return DEFAULT_WIDTH;
    return clampWidth(w);
  } catch (_) {
    return DEFAULT_WIDTH;
  }
}

function readSavedCollapsed() {
  try {
    const v = localStorage.getItem(STORAGE_COLLAPSED_KEY);
    if (v === "true" || v === "false") return v === "true";
  } catch (_) {}
  return false;
}

function persistWidth(px) {
  try {
    localStorage.setItem(STORAGE_WIDTH_KEY, String(px));
  } catch (_) {}
}

function persistCollapsed(flag) {
  try {
    localStorage.setItem(STORAGE_COLLAPSED_KEY, String(Boolean(flag)));
  } catch (_) {}
}

function getComputedSidebarWidth(root) {
  const style = getComputedStyle(root);
  const varValue = style.getPropertyValue("--sidebar-width") || "";
  const n = parseFloat(varValue);
  if (Number.isFinite(n)) return n;
  return DEFAULT_WIDTH;
}

function applyCollapsed(root, collapsed) {
  root.classList.toggle("is-sidebar-collapsed", Boolean(collapsed));
  root.dataset.sidebarCollapsed = String(Boolean(collapsed));
}

function applyWidth(root, px) {
  const width = clampWidth(px);
  root.style.setProperty("--sidebar-width", `${width}px`);
  return width;
}

export function initSidebar(shellRoot = document) {
  const appRoot = shellRoot.querySelector(":scope > .app-root") || document.querySelector(".app-root");
  const main = shellRoot.querySelector(".app-main") || shellRoot;
  const panels = shellRoot.querySelector("[data-panels]");
  if (!appRoot || !main || !panels) return;

  // Ensure CSS vars exist with safe defaults
  if (!getComputedStyle(appRoot).getPropertyValue("--sidebar-width")) {
    appRoot.style.setProperty("--sidebar-width", `${DEFAULT_WIDTH}px`);
  }

  // Build resizer element
  const resizer = document.createElement("div");
  resizer.className = "sidebar-resizer";
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "Resize sidebar");
  resizer.innerHTML = `
    <div class="sidebar-resizer__grip" aria-hidden="true"></div>
    <button type="button" class="sidebar-resizer__toggle" aria-pressed="false" title="Collapse sidebar">
      <span class="sr-only">Toggle sidebar</span>
      <span aria-hidden="true">❭</span>
    </button>
  `;

  // Because .app-main uses display: contents, appending here will place resizer in grid
  main.appendChild(resizer);

  const toggleBtn = resizer.querySelector(".sidebar-resizer__toggle");

  // Apply persisted state
  const savedWidth = readSavedWidth();
  const savedCollapsed = readSavedCollapsed();
  if (savedCollapsed) {
    applyCollapsed(appRoot, true);
    // Keep last saved width in storage for restore; also ensure CSS var reflects a 0 width collapsed state visibly
    appRoot.style.setProperty("--sidebar-width", `0px`);
  } else {
    applyCollapsed(appRoot, false);
    applyWidth(appRoot, savedWidth);
  }
  toggleBtn?.setAttribute("aria-pressed", String(Boolean(savedCollapsed)));

  let drag = {
    active: false,
    pointerId: null,
    startX: 0,
    startWidth: savedCollapsed ? savedWidth : getComputedSidebarWidth(appRoot),
  };

  function endDrag() {
    if (!drag.active) return;
    drag.active = false;
    try { if (drag.pointerId !== null) resizer.releasePointerCapture(drag.pointerId); } catch (_) {}
    appRoot.classList.remove("is-resizing");
    document.body.classList.remove("is-resizing");
    document.body.style.cursor = "";
    // Persist width if not collapsed
    const collapsed = appRoot.classList.contains("is-sidebar-collapsed");
    if (!collapsed) {
      const w = getComputedSidebarWidth(appRoot);
      persistWidth(w);
    }
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    drag.active = true;
    drag.pointerId = e.pointerId;
    drag.startX = e.clientX;
    drag.startWidth = appRoot.classList.contains("is-sidebar-collapsed")
      ? readSavedWidth()
      : getComputedSidebarWidth(appRoot);

    try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
    appRoot.classList.add("is-resizing");
    document.body.classList.add("is-resizing");
    document.body.style.cursor = "col-resize";

    // If collapsed, expand immediately to allow drag to resize from default width baseline
    if (appRoot.classList.contains("is-sidebar-collapsed")) {
      applyCollapsed(appRoot, false);
      applyWidth(appRoot, drag.startWidth);
      persistCollapsed(false);
      toggleBtn?.setAttribute("aria-pressed", "false");
    }
  }

  let rafPending = false;
  function handlePointerMove(e) {
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const next = clampWidth(drag.startWidth + dx);
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        applyWidth(appRoot, next);
      });
    }
  }

  function handlePointerUp(e) {
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    endDrag();
  }

  resizer.addEventListener("pointerdown", handlePointerDown);
  resizer.addEventListener("pointermove", handlePointerMove);
  resizer.addEventListener("pointerup", handlePointerUp);
  resizer.addEventListener("pointercancel", handlePointerUp);

  resizer.addEventListener("dblclick", () => {
    // Reset to default width
    const w = applyWidth(appRoot, DEFAULT_WIDTH);
    persistWidth(w);
  });

  toggleBtn?.addEventListener("click", () => {
    const collapsed = appRoot.classList.toggle("is-sidebar-collapsed");
    if (collapsed) {
      // collapse: set width CSS var to 0 but keep saved width in storage
      appRoot.style.setProperty("--sidebar-width", `0px`);
    } else {
      // expand to saved width
      const w = readSavedWidth();
      applyWidth(appRoot, w);
    }
    persistCollapsed(collapsed);
    toggleBtn.setAttribute("aria-pressed", String(collapsed));
  });
}
