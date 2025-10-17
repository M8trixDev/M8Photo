const globalScope = typeof window !== "undefined" ? window : globalThis;

function normaliseBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }

  return false;
}

function createAssertLogger(summary) {
  return function assert(condition, message) {
    if (condition) {
      summary.passed += 1;
      console.info(`%c\u2713 ${message}`, "color: #4caf50;");
    } else {
      summary.failed += 1;
      console.error(`\u2717 ${message}`);
    }
  };
}

export function runHarness({ store, history, eventBus }) {
  if (!store || !history || !eventBus) {
    console.warn("[M8Photo] Dev harness requires store, history, and event bus instances");
    return;
  }

  if (normaliseBooleanFlag(globalScope.__M8PHOTO_DEV_HARNESS_RUNNING__)) {
    console.warn("[M8Photo] Dev harness is already running. Skipping duplicate invocation.");
    return;
  }

  const historyIsClean = history.length === 0 && history.getPointer() === -1;

  if (!historyIsClean) {
    console.warn("[M8Photo] Dev harness skipped because history already contains commands.");
    return;
  }

  globalScope.__M8PHOTO_DEV_HARNESS_RUNNING__ = true;

  const initialSnapshot = store.getSnapshot();
  const summary = { passed: 0, failed: 0 };
  const assert = createAssertLogger(summary);

  const groupLabel = "M8Photo Dev Harness";
  if (typeof console.groupCollapsed === "function") {
    console.groupCollapsed(groupLabel);
  } else if (typeof console.group === "function") {
    console.group(groupLabel);
  }

  let undoListener = null;
  let redoListener = null;
  let ranMutations = false;

  try {
    const liveState = store.getState();
    assert(Object.isFrozen(liveState), "Store state is deeply frozen");
    assert(Object.isFrozen(liveState.project), "Project slice is frozen");

    const snapshot = store.getSnapshot();
    snapshot.project.name = "Mutated in snapshot";
    assert(
      store.getState().project.name !== "Mutated in snapshot",
      "Snapshots are safe to mutate without affecting store"
    );

    store.dispatch(
      (draft) => {
        const project = { ...draft.project, name: "Harness Project" };
        draft.project = project;
        return draft;
      },
      { reason: "dev-harness:project-name" }
    );
    ranMutations = true;
    assert(store.getState().project.name === "Harness Project", "Dispatch updated project name");

    if (!history.hasCommand("dev:increment")) {
      history.registerCommand("dev:increment", ({ payload }) => {
        const amount = typeof payload?.amount === "number" ? payload.amount : 1;

        return {
          label: `Increment by ${amount}`,
          meta: { amount },
          execute({ store: sharedStore }) {
            sharedStore.updateSlice("project", (project) => {
              const next = { ...project };
              const counter = typeof next.metadata.counter === "number" ? next.metadata.counter : 0;
              next.metadata = { ...next.metadata, counter: counter + amount };
              next.updatedAt = Date.now();
              return next;
            }, { reason: "dev-harness:increment" });
          },
          undo({ store: sharedStore }) {
            sharedStore.updateSlice("project", (project) => {
              const next = { ...project };
              const counter = typeof next.metadata.counter === "number" ? next.metadata.counter : 0;
              next.metadata = { ...next.metadata, counter: counter - amount };
              next.updatedAt = Date.now();
              return next;
            }, { reason: "dev-harness:increment-undo" });
          },
        };
      });
    }

    if (!history.hasCommand("dev:stroke")) {
      history.registerCommand("dev:stroke", ({ payload }) => {
        const strokeId = payload?.strokeId ?? "dev-stroke";
        const points = Array.isArray(payload?.points)
          ? payload.points.map((point) => ({ ...point }))
          : [];

        return {
          label: `Stroke ${strokeId}`,
          meta: { strokeId, pointCount: points.length },
          options: { coalesce: true, coalesceKey: strokeId, coalesceWindow: 750 },
          points: points.slice(),
          execute({ store: sharedStore }) {
            if (!this.points.length) {
              return;
            }

            sharedStore.updateSlice("layers", (layers) => {
              const nextLayers = { ...layers };
              const existingStroke = nextLayers.entities.__devStroke || { points: [] };
              const updatedStroke = {
                ...existingStroke,
                points: [...existingStroke.points, ...this.points],
              };

              nextLayers.entities = { ...nextLayers.entities, __devStroke: updatedStroke };
              nextLayers.stats = {
                ...nextLayers.stats,
                count: Object.keys(nextLayers.entities).length,
              };

              return nextLayers;
            }, { reason: "dev-harness:stroke" });
          },
          undo({ store: sharedStore }) {
            if (!this.points.length) {
              return;
            }

            sharedStore.updateSlice("layers", (layers) => {
              const nextLayers = { ...layers };
              const existingStroke = nextLayers.entities.__devStroke;

              if (!existingStroke) {
                return nextLayers;
              }

              const nextPoints = existingStroke.points.slice(
                0,
                Math.max(0, existingStroke.points.length - this.points.length)
              );

              nextLayers.entities = {
                ...nextLayers.entities,
                __devStroke: { ...existingStroke, points: nextPoints },
              };

              return nextLayers;
            }, { reason: "dev-harness:stroke-undo" });
          },
          coalesceWith(otherCommand) {
            if (!otherCommand || otherCommand.meta?.strokeId !== strokeId) {
              return false;
            }

            if (!Array.isArray(otherCommand.points) || otherCommand.points.length === 0) {
              return false;
            }

            this.points = [...this.points, ...otherCommand.points];
            this.meta.pointCount = (this.meta.pointCount || 0) + otherCommand.points.length;
            return true;
          },
        };
      });
    }

    const historyEvents = [];
    undoListener = eventBus.on("history:undo", (event) => {
      historyEvents.push({ type: event.type, pointer: event.detail?.pointer });
      console.log("[Harness] history:undo", event.detail);
    });

    redoListener = eventBus.on("history:redo", (event) => {
      historyEvents.push({ type: event.type, pointer: event.detail?.pointer });
      console.log("[Harness] history:redo", event.detail);
    });

    history.execute("dev:increment", { amount: 2 }, { meta: { source: "dev-harness" } });
    history.execute("dev:increment", { amount: 3 }, { meta: { source: "dev-harness" } });
    assert(history.canUndo(), "History reports undo available after executes");
    assert(store.getState().project.metadata.counter === 5, "Counter accumulated expected value");

    history.undo();
    assert(store.getState().project.metadata.counter === 2, "Undo reverted the last increment");

    history.redo();
    assert(store.getState().project.metadata.counter === 5, "Redo restored the increment");

    assert(historyEvents.some((event) => event.type === "history:undo"), "Undo event emitted via event bus");
    assert(historyEvents.some((event) => event.type === "history:redo"), "Redo event emitted via event bus");

    const lengthBeforeStroke = history.length;
    history.execute(
      "dev:stroke",
      { strokeId: "coalesce", points: [{ x: 0, y: 0 }] },
      { meta: { source: "dev-harness" } }
    );
    const lengthAfterStroke = history.length;
    history.execute(
      "dev:stroke",
      { strokeId: "coalesce", points: [{ x: 1, y: 1 }] },
      { meta: { source: "dev-harness" } }
    );

    assert(lengthAfterStroke === history.length, "Stroke commands coalesced into a single entry");

    const activeEntry = history.getStackSnapshot()[history.getPointer()];
    assert(activeEntry.revisions >= 2, "Coalesced entry tracked revision count");

    history.undo();
    const strokePoints = store.getState().layers.entities.__devStroke?.points || [];
    assert(strokePoints.length === 0, "Undo cleared coalesced stroke points");
  } catch (error) {
    console.error("[M8Photo] Development harness error", error);
  } finally {
    if (typeof undoListener === "function") {
      undoListener();
    }

    if (typeof redoListener === "function") {
      redoListener();
    }

    if (ranMutations) {
      try {
        history.clear({ reason: "dev-harness:cleanup" });
      } catch (error) {
        console.warn("[M8Photo] Unable to clear history during harness cleanup", error);
      }

      try {
        store.replace(initialSnapshot, { reason: "dev-harness:cleanup" });
      } catch (error) {
        console.warn("[M8Photo] Unable to restore store snapshot after harness", error);
      }
    }

    if (typeof console.groupEnd === "function") {
      console.groupEnd();
    }

    console.info(
      `[Harness] Assertions passed: ${summary.passed}${summary.failed ? `, failed: ${summary.failed}` : ""}`
    );

    globalScope.__M8PHOTO_DEV_HARNESS_RUNNING__ = false;
  }
}
