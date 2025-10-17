import { initToolbar } from "./toolbar.js";
import { initPanels } from "./panels.js";

function bootAppShell() {
  const shellRoot = document.querySelector("[data-app-shell]");
  if (!shellRoot) {
    return;
  }

  initToolbar(shellRoot);
  initPanels(shellRoot);
  initialiseCollapsibles(shellRoot);
  shellRoot.classList.add("is-initialised");
}

function initialiseCollapsibles(scope = document) {
  const sections = scope.querySelectorAll("[data-collapsible]");

  sections.forEach((section) => {
    const toggle = section.querySelector("[data-collapsible-toggle]");
    const content = section.querySelector("[data-collapsible-content]");

    if (!toggle || !content) {
      return;
    }

    const collapsedInitial = section.classList.contains("is-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsedInitial));
    content.hidden = collapsedInitial;

    toggle.addEventListener("click", () => {
      const collapsed = section.classList.toggle("is-collapsed");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      content.hidden = collapsed;
    });
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bootAppShell();
  registerServiceWorker();
});
