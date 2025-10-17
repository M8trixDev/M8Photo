import { store } from "./store.js";
import { eventBus } from "./events.js";

const DEFAULT_HISTORY_CAPACITY = 100;
const DEFAULT_COALESCE_WINDOW = 350; // milliseconds

let commandSequence = 0;

function nextCommandId() {
  commandSequence += 1;
  return `cmd_${Date.now()}_${commandSequence}`;
}

function toPositiveNumber(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return value > 0 ? value : fallback;
}

function toNonNegativeNumber(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return value >= 0 ? value : fallback;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serialiseEntry(entry) {
  return {
    id: entry.id,
    label: entry.label,
    type: entry.type,
    timestamp: entry.timestamp,
    revisions: entry.revisions,
    meta: entry.meta,
    options: {
      coalesce: entry.options.coalesce,
      coalesceKey: entry.options.coalesceKey,
      coalesceWindow: entry.options.coalesceWindow,
    },
  };
}

export function createHistoryManager(config = {}) {
  const settings = {
    capacity: toPositiveNumber(config.capacity, DEFAULT_HISTORY_CAPACITY),
    coalesceWindow: toNonNegativeNumber(config.coalesceWindow, DEFAULT_COALESCE_WINDOW),
  };

  const commandRegistry = new Map();
  const historyStack = [];
  let pointer = -1;

  const sharedStore = config.store ?? store;
  const bus = config.eventBus ?? eventBus;

  function syncStoreHistory(meta = {}) {
    if (!sharedStore || typeof sharedStore.updateSlice !== "function") {
      return;
    }

    sharedStore.updateSlice(
      "history",
      (historySlice) => {
        const next = { ...historySlice };
        next.pointer = pointer;
        next.size = historyStack.length;
        next.canUndo = pointer >= 0;
        next.canRedo = pointer < historyStack.length - 1;
        next.capacity = settings.capacity;
        next.version = (historySlice.version || 0) + 1;
        next.lastCommand = pointer >= 0 ? { ...serialiseEntry(historyStack[pointer]) } : null;
        return next;
      },
      { ...meta, source: "history" }
    );
  }

  function truncateFuture(reason) {
    if (pointer >= historyStack.length - 1) {
      return [];
    }

    const removed = historyStack.splice(pointer + 1);

    if (removed.length && bus) {
      bus.emit("history:truncate", {
        reason,
        removed: removed.map((entry) => serialiseEntry(entry)),
      });
    }

    return removed;
  }

  function enforceCapacity(reason) {
    if (historyStack.length <= settings.capacity) {
      return [];
    }

    const overflow = historyStack.length - settings.capacity;
    const removed = historyStack.splice(0, overflow);
    pointer -= overflow;

    if (pointer < -1) {
      pointer = -1;
    }

    if (bus && removed.length) {
      bus.emit("history:overflow", {
        reason,
        removed: removed.map((entry) => serialiseEntry(entry)),
      });
    }

    return removed;
  }

  function validateCommand(command) {
    if (!command || typeof command !== "object") {
      throw new TypeError("Command definition must be an object");
    }

    if (typeof command.execute !== "function") {
      throw new TypeError("Command must implement an execute(context) function");
    }

    if (typeof command.undo !== "function") {
      throw new TypeError("Command must implement an undo(context) function");
    }
  }

  function hydrateCommand(target, payload, options = {}) {
    if (typeof target === "string") {
      const factory = commandRegistry.get(target);

      if (!factory) {
        throw new ReferenceError(`No command factory registered for key \"${target}\"`);
      }

      const descriptor = factory({ payload, options: { ...options } });

      if (!descriptor || typeof descriptor !== "object") {
        throw new TypeError("Command factory must return a command object");
      }

      return { ...descriptor, type: target };
    }

    if (typeof target === "function") {
      const descriptor = target({ payload, options: { ...options } });

      if (!descriptor || typeof descriptor !== "object") {
        throw new TypeError("Command factory must return a command object");
      }

      return descriptor;
    }

    if (target && typeof target === "object") {
      return { ...target };
    }

    throw new TypeError("Unsupported command reference provided to history");
  }

  function buildEntry(descriptor, payload, overrides = {}) {
    validateCommand(descriptor);

    const descriptorOptions = isPlainObject(descriptor.options) ? { ...descriptor.options } : {};
    const descriptorMeta = isPlainObject(descriptor.meta) ? { ...descriptor.meta } : {};

    const coalesceEnabled = Boolean(
      overrides.coalesce ?? descriptorOptions.coalesce ?? false
    );

    const label = descriptor.label || overrides.label || descriptor.type || "Command";

    const entry = {
      id: descriptor.id || overrides.id || nextCommandId(),
      label,
      type: descriptor.type || overrides.type || null,
      command: descriptor,
      payload,
      timestamp: Date.now(),
      revisions: 1,
      options: {
        coalesce: coalesceEnabled,
        coalesceKey:
          overrides.coalesceKey ||
          descriptorOptions.coalesceKey ||
          descriptor.type ||
          descriptor.id ||
          label,
        coalesceWindow: toNonNegativeNumber(
          overrides.coalesceWindow ?? descriptorOptions.coalesceWindow,
          settings.coalesceWindow
        ),
      },
      meta: {
        ...descriptorMeta,
        ...(isPlainObject(overrides.meta) ? overrides.meta : {}),
      },
    };

    return entry;
  }

  function buildContext(phase, entry) {
    return {
      phase,
      entry,
      command: entry.command,
      payload: entry.payload,
      store: sharedStore,
      history: api,
      eventBus: bus,
      timestamp: Date.now(),
      settings: { ...settings },
    };
  }

  function attemptCoalesce(previousEntry, nextEntry, context) {
    if (!previousEntry || !nextEntry) {
      return false;
    }

    if (!previousEntry.options.coalesce || !nextEntry.options.coalesce) {
      return false;
    }

    if (previousEntry.options.coalesceKey !== nextEntry.options.coalesceKey) {
      return false;
    }

    const windowSize = Math.max(
      0,
      nextEntry.options.coalesceWindow,
      previousEntry.options.coalesceWindow,
      settings.coalesceWindow
    );

    if (nextEntry.timestamp - previousEntry.timestamp > windowSize) {
      return false;
    }

    const contextForCoalesce = {
      ...context,
      phase: "coalesce",
      previous: previousEntry,
      next: nextEntry,
    };

    const previousCommand = previousEntry.command;
    const nextCommand = nextEntry.command;

    const candidateFns = [
      { fn: previousCommand?.coalesceWith, context: previousCommand, operand: nextCommand },
      { fn: previousCommand?.mergeWith, context: previousCommand, operand: nextCommand },
      { fn: previousCommand?.extend, context: previousCommand, operand: nextCommand },
      { fn: nextCommand?.mergeInto, context: nextCommand, operand: previousCommand },
      { fn: nextCommand?.coalesceInto, context: nextCommand, operand: previousCommand },
    ].filter((candidate) => typeof candidate.fn === "function");

    if (candidateFns.length === 0) {
      return false;
    }

    const didCoalesce = candidateFns.some(({ fn, context: fnContext, operand }) => {
      try {
        const result = fn.call(fnContext, operand, contextForCoalesce);
        return result !== false;
      } catch (error) {
        console.error("Command coalescing failed", error);
        return false;
      }
    });

    if (!didCoalesce) {
      return false;
    }

    previousEntry.timestamp = nextEntry.timestamp;
    previousEntry.revisions = (previousEntry.revisions || 1) + 1;
    previousEntry.meta = { ...previousEntry.meta, ...nextEntry.meta };
    previousEntry.options.coalesceWindow = Math.max(
      previousEntry.options.coalesceWindow,
      nextEntry.options.coalesceWindow
    );

    if (typeof nextCommand?.dispose === "function") {
      try {
        nextCommand.dispose(contextForCoalesce);
      } catch (error) {
        console.error("Command dispose after coalesce failed", error);
      }
    }

    if (bus) {
      bus.emit("history:coalesced", {
        merged: serialiseEntry(previousEntry),
        discarded: serialiseEntry(nextEntry),
      });
    }

    return true;
  }

  function execute(target, payload, options = {}) {
    const descriptor = hydrateCommand(target, payload, options);
    const entry = buildEntry(descriptor, payload, options);

    const context = buildContext("execute", entry);
    let result;

    try {
      result = entry.command.execute(context);
    } catch (error) {
      throw error;
    }

    truncateFuture("execute");

    const previousEntry = pointer >= 0 ? historyStack[pointer] : null;

    if (attemptCoalesce(previousEntry, entry, context)) {
      syncStoreHistory({ reason: "coalesce" });
      return result;
    }

    historyStack.push(entry);
    pointer = historyStack.length - 1;

    enforceCapacity("execute");

    syncStoreHistory({ reason: "execute" });

    if (bus) {
      bus.emit("history:execute", {
        entry: serialiseEntry(historyStack[pointer]),
      });
    }

    return result;
  }

  function undo() {
    if (pointer < 0) {
      return null;
    }

    const entry = historyStack[pointer];
    const context = buildContext("undo", entry);

    let result;

    try {
      result = entry.command.undo(context);
      pointer -= 1;
      syncStoreHistory({ reason: "undo" });
    } catch (error) {
      throw error;
    }

    if (bus) {
      bus.emit("history:undo", {
        entry: serialiseEntry(entry),
        pointer,
      });
    }

    return result;
  }

  function redo() {
    if (pointer >= historyStack.length - 1) {
      return null;
    }

    const entry = historyStack[pointer + 1];
    const context = buildContext("redo", entry);

    let result;

    try {
      if (typeof entry.command.redo === "function") {
        result = entry.command.redo(context);
      } else {
        result = entry.command.execute(context);
      }

      pointer += 1;
      syncStoreHistory({ reason: "redo" });
    } catch (error) {
      throw error;
    }

    if (bus) {
      bus.emit("history:redo", {
        entry: serialiseEntry(entry),
        pointer,
      });
    }

    return result;
  }

  function clear(options = {}) {
    if (!historyStack.length) {
      return;
    }

    historyStack.splice(0, historyStack.length);
    pointer = -1;

    syncStoreHistory({ reason: options.reason ?? "clear" });

    if (bus) {
      bus.emit("history:clear", {
        reason: options.reason ?? "clear",
      });
    }
  }

  function configure(nextOptions = {}) {
    if (isPlainObject(nextOptions)) {
      if (typeof nextOptions.capacity === "number" && nextOptions.capacity > 0) {
        settings.capacity = Math.floor(nextOptions.capacity);
      }

      if (typeof nextOptions.coalesceWindow === "number" && nextOptions.coalesceWindow >= 0) {
        settings.coalesceWindow = nextOptions.coalesceWindow;
      }

      enforceCapacity("configure");
      syncStoreHistory({ reason: "configure" });

      if (bus) {
        bus.emit("history:configure", {
          settings: { ...settings },
        });
      }
    }
  }

  function registerCommand(name, factory) {
    if (typeof name !== "string" || name.trim() === "") {
      throw new TypeError("Command name must be a non-empty string");
    }

    if (typeof factory !== "function") {
      throw new TypeError("Command factory must be a function");
    }

    commandRegistry.set(name, factory);

    return () => {
      commandRegistry.delete(name);
    };
  }

  function hasCommand(name) {
    return commandRegistry.has(name);
  }

  function getCommandNames() {
    return Array.from(commandRegistry.keys());
  }

  function getStackSnapshot() {
    return historyStack.map((entry) => serialiseEntry(entry));
  }

  function getPointer() {
    return pointer;
  }

  function canUndo() {
    return pointer >= 0;
  }

  function canRedo() {
    return pointer < historyStack.length - 1;
  }

  const api = {
    registerCommand,
    hasCommand,
    getCommandNames,
    execute,
    undo,
    redo,
    clear,
    configure,
    canUndo,
    canRedo,
    getPointer,
    getStackSnapshot,
    get length() {
      return historyStack.length;
    },
    get capacity() {
      return settings.capacity;
    },
  };

  syncStoreHistory({ reason: "init" });

  return api;
}

export const history = createHistoryManager({ store, eventBus });
