const DEFAULT_PRIORITY = 0;

function normaliseEventName(name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("Event name must be a non-empty string");
  }

  return name.trim();
}

export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(eventName, handler, options = {}) {
    const name = normaliseEventName(eventName);

    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function");
    }

    const entry = {
      handler,
      once: Boolean(options.once),
      priority: typeof options.priority === "number" ? options.priority : DEFAULT_PRIORITY,
    };

    const listeners = this._listeners.get(name) || [];
    listeners.push(entry);
    listeners.sort((a, b) => b.priority - a.priority);
    this._listeners.set(name, listeners);

    if (typeof AbortSignal !== "undefined" && options.signal instanceof AbortSignal) {
      options.signal.addEventListener(
        "abort",
        () => {
          this.off(name, handler);
        },
        { once: true }
      );
    }

    return () => this.off(name, handler);
  }

  once(eventName, handler, options = {}) {
    return this.on(eventName, handler, { ...options, once: true });
  }

  off(eventName, handler) {
    const name = normaliseEventName(eventName);
    const listeners = this._listeners.get(name);

    if (!listeners || listeners.length === 0) {
      return false;
    }

    const index = listeners.findIndex((entry) => entry.handler === handler);

    if (index === -1) {
      return false;
    }

    listeners.splice(index, 1);

    if (listeners.length === 0) {
      this._listeners.delete(name);
    }

    return true;
  }

  emit(eventName, detail) {
    const name = normaliseEventName(eventName);
    const listeners = this._listeners.get(name);

    if (!listeners || listeners.length === 0) {
      return [];
    }

    const payload = {
      type: name,
      detail,
      timestamp: Date.now(),
    };

    const responses = [];

    // Clone the listeners array to avoid issues if handlers mutate the list mid-flight.
    listeners.slice().forEach((entry) => {
      try {
        const response = entry.handler(payload);
        responses.push(response);
      } catch (error) {
        // Surface the error but keep notifying other subscribers.
        console.error(`Event handler for "${name}" failed`, error);
        responses.push(error);
      }

      if (entry.once) {
        this.off(name, entry.handler);
      }
    });

    return responses;
  }

  emitAsync(eventName, detail) {
    const name = normaliseEventName(eventName);
    const listeners = this._listeners.get(name);

    if (!listeners || listeners.length === 0) {
      return Promise.resolve([]);
    }

    const payload = {
      type: name,
      detail,
      timestamp: Date.now(),
    };

    return Promise.all(
      listeners.slice().map(async (entry) => {
        try {
          const response = await entry.handler(payload);
          if (entry.once) {
            this.off(name, entry.handler);
          }
          return response;
        } catch (error) {
          console.error(`Async event handler for "${name}" failed`, error);
          return error;
        }
      })
    );
  }

  clear(eventName) {
    if (typeof eventName === "undefined") {
      this._listeners.clear();
      return;
    }

    const name = normaliseEventName(eventName);
    this._listeners.delete(name);
  }

  listenerCount(eventName) {
    if (typeof eventName === "undefined") {
      let count = 0;
      for (const listeners of this._listeners.values()) {
        count += listeners.length;
      }
      return count;
    }

    const name = normaliseEventName(eventName);
    const listeners = this._listeners.get(name);
    return listeners ? listeners.length : 0;
  }

  listeners(eventName) {
    const name = normaliseEventName(eventName);
    const listeners = this._listeners.get(name) || [];
    return listeners.map((entry) => entry.handler);
  }
}

export function createEventBus() {
  return new EventBus();
}

export const eventBus = createEventBus();
