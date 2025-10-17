function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function mergeState(current, partial) {
  if (!isPlainObject(partial)) {
    return partial;
  }

  const result = { ...current };
  let hasChanges = false;

  for (const [key, value] of Object.entries(partial)) {
    const existing = current[key];

    if (isPlainObject(value) && isPlainObject(existing)) {
      const merged = mergeState(existing, value);
      if (merged !== existing) {
        result[key] = merged;
        hasChanges = true;
      }
    } else if (Array.isArray(value)) {
      if (!Array.isArray(existing) || existing !== value) {
        result[key] = value.slice();
        hasChanges = true;
      }
    } else if (value !== existing) {
      result[key] = value;
      hasChanges = true;
    }
  }

  return hasChanges ? result : current;
}

function cloneInitialState(source) {
  if (typeof structuredClone === "function") {
    return structuredClone(source);
  }

  return JSON.parse(JSON.stringify(source));
}

export function createStore(initialState = {}) {
  let state = cloneInitialState(initialState);
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(updater, options = {}) {
    const { silent = false } = options;
    const patch = typeof updater === "function" ? updater(state) : updater;

    if (patch == null) {
      return state;
    }

    const nextState = mergeState(state, patch);

    if (nextState === state) {
      return state;
    }

    state = nextState;

    if (!silent) {
      listeners.forEach((listener) => listener(state));
    }

    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    getState,
    setState,
    subscribe,
  };
}
