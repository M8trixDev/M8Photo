import { eventBus } from "./events.js";

const DEFAULT_HISTORY_CAPACITY = 100;

const hasStructuredClone = typeof structuredClone === "function";

function cloneValue(value) {
  if (hasStructuredClone) {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  Object.getOwnPropertyNames(value).forEach((key) => {
    deepFreeze(value[key]);
  });

  return value;
}

function mergeDeep(target, source) {
  if (!isPlainObject(source)) {
    return cloneValue(source);
  }

  const output = isPlainObject(target) ? { ...target } : {};

  Object.keys(source).forEach((key) => {
    const value = source[key];

    if (Array.isArray(value)) {
      output[key] = value.map((item) => (isPlainObject(item) ? mergeDeep({}, item) : cloneValue(item)));
      return;
    }

    if (isPlainObject(value)) {
      output[key] = mergeDeep(output[key], value);
      return;
    }

    output[key] = value;
  });

  return output;
}

const defaultState = deepFreeze({
  project: {
    id: null,
    name: "Untitled Project",
    description: "",
    createdAt: null,
    updatedAt: null,
    metadata: {},
  },
  layers: {
    order: [],
    entities: {},
    active: null,
    stats: {
      count: 0,
      visible: 0,
    },
  },
  viewport: {
    zoom: 1,
    pan: { x: 0, y: 0 },
    rotation: 0,
    size: { width: 1280, height: 720 },
  },
  tools: {
    active: "pointer",
    options: {},
    lastUsed: null,
  },
  selection: {
    items: [],
    bounds: null,
    mode: "replace",
  },
  history: {
    pointer: -1,
    size: 0,
    canUndo: false,
    canRedo: false,
    capacity: DEFAULT_HISTORY_CAPACITY,
    version: 0,
    lastCommand: null,
  },
});

deepFreeze(defaultState.project);
deepFreeze(defaultState.layers);
deepFreeze(defaultState.viewport);
deepFreeze(defaultState.tools);
deepFreeze(defaultState.selection);
deepFreeze(defaultState.history);

function createStore(initialState = defaultState, options = {}) {
  const bus = options.eventBus ?? eventBus;
  let state = deepFreeze(cloneValue(initialState));
  let version = 0;

  const subscribers = new Set();

  function notifySubscribers(meta) {
    subscribers.forEach((subscription) => {
      let nextValue;
      try {
        nextValue = subscription.selector(state);
      } catch (error) {
        console.error("Store selector failed", error);
        return;
      }

      const hasChanged = !subscription.equality(nextValue, subscription.lastValue);

      if (!hasChanged) {
        return;
      }

      const previous = subscription.lastValue;
      subscription.lastValue = nextValue;

      try {
        subscription.listener(cloneValue(nextValue), previous === undefined ? undefined : cloneValue(previous), meta);
      } catch (error) {
        console.error("Store subscriber failed", error);
      }
    });
  }

  function setState(nextState, meta = {}) {
    if (!isPlainObject(nextState)) {
      throw new TypeError("Next state must be a plain object");
    }

    const frozenNextState = deepFreeze(nextState);

    if (Object.is(frozenNextState, state)) {
      return state;
    }

    state = frozenNextState;
    version += 1;

    notifySubscribers(meta);

    if (bus) {
      bus.emit("store:change", {
        state: cloneValue(state),
        meta: { ...meta, version },
      });
    }

    return state;
  }

  function dispatch(updater, meta = {}) {
    if (typeof updater === "function") {
      const workingState = cloneValue(state);
      const result = updater(workingState, cloneValue(state));
      const nextState = result !== undefined ? result : workingState;
      return setState(nextState, meta);
    }

    if (isPlainObject(updater)) {
      const workingState = cloneValue(state);
      const nextState = mergeDeep(workingState, updater);
      return setState(nextState, meta);
    }

    throw new TypeError("Dispatch expects a function updater or plain object with changes");
  }

  function updateSlice(sliceKey, updater, meta = {}) {
    if (typeof sliceKey !== "string" || !(sliceKey in state)) {
      throw new ReferenceError(`Unknown state slice: ${sliceKey}`);
    }

    return dispatch((workingState) => {
      const currentSlice = cloneValue(workingState[sliceKey]);
      let nextSlice;

      if (typeof updater === "function") {
        const result = updater(currentSlice, cloneValue(state[sliceKey]));
        nextSlice = result !== undefined ? result : currentSlice;
      } else if (isPlainObject(updater)) {
        nextSlice = mergeDeep(currentSlice, updater);
      } else {
        throw new TypeError("Slice updater must be a function or plain object");
      }

      workingState[sliceKey] = nextSlice;
      return workingState;
    }, meta);
  }

  function replace(nextState, meta = {}) {
    return setState(cloneValue(nextState), meta);
  }

  function reset(meta = {}) {
    return setState(cloneValue(initialState), meta);
  }

  function getState() {
    return state;
  }

  function getSnapshot() {
    return cloneValue(state);
  }

  function select(selector) {
    const resolvedSelector = typeof selector === "function" ? selector : (value) => value;
    return resolvedSelector(state);
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      throw new TypeError("Store subscription listener must be a function");
    }

    const selector = typeof options.selector === "function" ? options.selector : (value) => value;
    const equality = typeof options.equality === "function" ? options.equality : Object.is;

    const subscription = {
      listener,
      selector,
      equality,
      lastValue: selector(state),
    };

    subscribers.add(subscription);

    if (options.fireImmediately) {
      listener(cloneValue(subscription.lastValue), undefined, { immediate: true });
    }

    return () => {
      subscribers.delete(subscription);
    };
  }

  function destroy() {
    subscribers.clear();
  }

  return {
    dispatch,
    updateSlice,
    replace,
    reset,
    getState,
    getSnapshot,
    select,
    subscribe,
    destroy,
    get version() {
      return version;
    },
  };
}

export const store = createStore();
export { defaultState as initialState, cloneValue as cloneStateValue, createStore as createStateStore };
