const STORAGE_KEY = "m8photo.shortcuts.v1";

export function getDefaultShortcutMap() {
  return {
    "tool.move": "v",
    "tool.select.marquee": "m",
    "tool.select.lasso": "l",
    "tool.crop": "c",
    "tool.brush": "b",
    "tool.eraser": "e",
    "tool.fill": "g",
    "tool.text": "t",
    "tool.shape": "u",
    "tool.eyedropper": "i",
    "tool.hand": "h",
    "tool.zoom": "z",
  };
}

export function getShortcutMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...getDefaultShortcutMap() };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...getDefaultShortcutMap() };
    return { ...getDefaultShortcutMap(), ...parsed };
  } catch (_) {
    return { ...getDefaultShortcutMap() };
  }
}

export function setShortcutMap(next) {
  const defaults = getDefaultShortcutMap();
  const merged = { ...defaults, ...(next || {}) };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('m8:shortcuts:updated')); } catch (_) {}
  return merged;
}

export function resolveActionFromKey(key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  const map = getShortcutMap();
  const entries = Object.entries(map);
  for (let i = 0; i < entries.length; i += 1) {
    const [action, assigned] = entries[i];
    if (String(assigned).toLowerCase() === k) return action;
  }
  return null;
}

export function detectConflicts(map) {
  const m = map || getShortcutMap();
  const used = new Map();
  const conflicts = [];
  Object.entries(m).forEach(([action, key]) => {
    const k = String(key).toLowerCase();
    if (!k) return;
    if (used.has(k)) {
      conflicts.push([used.get(k), action]);
    } else {
      used.set(k, action);
    }
  });
  return conflicts;
}
