import {
  isPersistenceSupported,
  saveProjectSnapshot,
  saveHistoryCheckpoint,
  getLastProjectId,
  getLatestSnapshot,
  getLatestCheckpoint,
  touchProject,
  pruneSnapshots,
  pruneCheckpoints,
} from "./indexeddb.js";

const DEFAULT_AUTOSAVE_SETTINGS = Object.freeze({
  snapshotInterval: 8000,
  checkpointInterval: 2250,
  maxSnapshots: 6,
  maxCheckpoints: 32,
});

const MIN_SNAPSHOT_INTERVAL = 1500;
const MIN_CHECKPOINT_INTERVAL = 750;

const globalScope = typeof window !== "undefined" ? window : globalThis;

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function generateProjectId() {
  try {
    if (typeof globalScope.crypto?.randomUUID === "function") {
      return globalScope.crypto.randomUUID();
    }
  } catch (error) {
    // Ignore and fall back to manual generation.
  }

  const random = Math.random().toString(16).slice(2, 10);
  return `proj_${Date.now()}_${random}`;
}

function normaliseNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function normaliseReason(reason, fallback) {
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  return fallback;
}

function buildHistorySignature(historyState) {
  if (!historyState || !Array.isArray(historyState.entries) || !historyState.entries.length) {
    return "__history_empty__";
  }

  const pointer = typeof historyState.pointer === "number" ? historyState.pointer : -1;
  const tokens = historyState.entries.slice(0, 120).map((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "?";
    const revisions = typeof entry?.revisions === "number" ? entry.revisions : 0;
    return `${id}:${revisions}`;
  });

  return `${pointer}::${historyState.entries.length}::${tokens.join("|")}`;
}

function selectProjectMetadata(state) {
  if (!state || typeof state !== "object") {
    return { name: undefined, description: undefined };
  }
  const project = state.project || {};
  return {
    name: typeof project.name === "string" ? project.name : undefined,
    description: typeof project.description === "string" ? project.description : undefined,
    metadata: project.metadata && typeof project.metadata === "object" ? project.metadata : undefined,
  };
}

export function initialiseAutosave(options = {}) {
  const { store, history, eventBus, config = {} } = options;

  if (!store || typeof store.getState !== "function" || typeof store.replace !== "function") {
    console.warn("[M8Photo] Autosave requires a valid store instance");
    return {
      ready: Promise.resolve(false),
      flush: async () => ({ snapshot: false, checkpoint: false }),
      destroy: () => {},
      isSupported: false,
    };
  }

  if (!history || typeof history.exportState !== "function") {
    console.warn("[M8Photo] Autosave requires history manager with export/import support");
    return {
      ready: Promise.resolve(false),
      flush: async () => ({ snapshot: false, checkpoint: false }),
      destroy: () => {},
      isSupported: false,
    };
  }

  const persistenceSupported = isPersistenceSupported();

  const settings = {
    snapshotInterval: Math.max(
      MIN_SNAPSHOT_INTERVAL,
      normaliseNumber(config.snapshotInterval, DEFAULT_AUTOSAVE_SETTINGS.snapshotInterval)
    ),
    checkpointInterval: Math.max(
      MIN_CHECKPOINT_INTERVAL,
      normaliseNumber(config.checkpointInterval, DEFAULT_AUTOSAVE_SETTINGS.checkpointInterval)
    ),
    maxSnapshots: Math.max(0, Math.floor(normaliseNumber(config.maxSnapshots, DEFAULT_AUTOSAVE_SETTINGS.maxSnapshots))),
    maxCheckpoints: Math.max(0, Math.floor(normaliseNumber(config.maxCheckpoints, DEFAULT_AUTOSAVE_SETTINGS.maxCheckpoints))),
  };

  const state = {
    projectId: null,
    initialising: true,
    disposed: false,
    lastSnapshotVersion: null,
    lastCheckpointSignature: null,
    snapshotTimer: null,
    checkpointTimer: null,
    pendingSnapshotReason: null,
    pendingCheckpointReason: null,
  };

  const deferred = createDeferred();
  const cleanupTasks = [];

  function clearSnapshotTimer() {
    if (state.snapshotTimer) {
      globalScope.clearTimeout(state.snapshotTimer);
      state.snapshotTimer = null;
    }
  }

  function clearCheckpointTimer() {
    if (state.checkpointTimer) {
      globalScope.clearTimeout(state.checkpointTimer);
      state.checkpointTimer = null;
    }
  }

  async function ensureProjectId() {
    if (state.projectId) {
      return state.projectId;
    }

    const current = store.getState();
    const existingId = current?.project?.id;

    if (typeof existingId === "string" && existingId.trim()) {
      state.projectId = existingId.trim();
      return state.projectId;
    }

    const newId = generateProjectId();
    state.projectId = newId;

    store.updateSlice(
      "project",
      (project) => {
        const next = { ...project };
        next.id = newId;
        if (!next.createdAt) {
          next.createdAt = Date.now();
        }
        next.updatedAt = Date.now();
        return next;
      },
      { reason: "autosave:assign-id" }
    );

    if (persistenceSupported) {
      try {
        const snapshot = store.getState();
        const meta = selectProjectMetadata(snapshot);
        await touchProject(newId, {
          markAsLast: true,
          lastOpenedAt: Date.now(),
          name: meta.name,
          description: meta.description,
          metadata: meta.metadata,
        });
      } catch (error) {
        console.warn("[M8Photo] Unable to record project metadata", error);
      }
    }

    return newId;
  }

  function scheduleSnapshot(reason) {
    if (!persistenceSupported || state.disposed || state.initialising) {
      return;
    }

    clearSnapshotTimer();
    state.pendingSnapshotReason = normaliseReason(reason, "autosave:snapshot");
    state.snapshotTimer = globalScope.setTimeout(() => {
      flushSnapshot(state.pendingSnapshotReason).catch((error) => {
        console.warn("[M8Photo] Autosave snapshot failed", error);
      });
    }, settings.snapshotInterval);
  }

  function scheduleCheckpoint(reason) {
    if (!persistenceSupported || state.disposed || state.initialising) {
      return;
    }

    clearCheckpointTimer();
    state.pendingCheckpointReason = normaliseReason(reason, "autosave:checkpoint");
    state.checkpointTimer = globalScope.setTimeout(() => {
      flushCheckpoint(state.pendingCheckpointReason).catch((error) => {
        console.warn("[M8Photo] Autosave checkpoint failed", error);
      });
    }, settings.checkpointInterval);
  }

  async function flushSnapshot(reason) {
    clearSnapshotTimer();

    if (!persistenceSupported || state.disposed) {
      state.pendingSnapshotReason = null;
      return false;
    }

    const currentVersion = typeof store.version === "number" ? store.version : null;

    if (currentVersion !== null && currentVersion === state.lastSnapshotVersion) {
      state.pendingSnapshotReason = null;
      return false;
    }

    const projectId = await ensureProjectId();

    if (!projectId) {
      state.pendingSnapshotReason = null;
      return false;
    }

    const snapshot = store.getSnapshot();
    const reasonTag = normaliseReason(reason || state.pendingSnapshotReason, "autosave:snapshot");

    try {
      await saveProjectSnapshot({ projectId, state: snapshot, version: currentVersion, reason: reasonTag });
      if (settings.maxSnapshots > 0) {
        await pruneSnapshots(projectId, settings.maxSnapshots);
      }
      state.lastSnapshotVersion = currentVersion;
      state.pendingSnapshotReason = null;
      return true;
    } catch (error) {
      state.pendingSnapshotReason = null;
      throw error;
    }
  }

  async function flushCheckpoint(reason) {
    clearCheckpointTimer();

    if (!persistenceSupported || state.disposed) {
      state.pendingCheckpointReason = null;
      return false;
    }

    const projectId = await ensureProjectId();

    if (!projectId) {
      state.pendingCheckpointReason = null;
      return false;
    }

    if (typeof history.exportState !== "function") {
      state.pendingCheckpointReason = null;
      return false;
    }

    const historyState = history.exportState();

    if (!historyState) {
      state.pendingCheckpointReason = null;
      return false;
    }

    if (historyState.hydratable === false) {
      state.pendingCheckpointReason = null;
      return false;
    }

    const signature = buildHistorySignature(historyState);

    if (signature === state.lastCheckpointSignature) {
      state.pendingCheckpointReason = null;
      return false;
    }

    const reasonTag = normaliseReason(reason || state.pendingCheckpointReason, "autosave:checkpoint");

    try {
      await saveHistoryCheckpoint({ projectId, checkpoint: historyState, version: store.version, reason: reasonTag });
      if (settings.maxCheckpoints > 0) {
        await pruneCheckpoints(projectId, settings.maxCheckpoints);
      }
      state.lastCheckpointSignature = signature;
      state.pendingCheckpointReason = null;
      return true;
    } catch (error) {
      state.pendingCheckpointReason = null;
      throw error;
    }
  }

  async function flush(reason = "autosave:flush") {
    if (!persistenceSupported || state.disposed) {
      return { snapshot: false, checkpoint: false };
    }

    const results = await Promise.allSettled([flushSnapshot(reason), flushCheckpoint(reason)]);

    return {
      snapshot: results[0].status === "fulfilled" ? results[0].value : false,
      checkpoint: results[1].status === "fulfilled" ? results[1].value : false,
    };
  }

  function handleStoreChange(event) {
    if (state.initialising || state.disposed || !persistenceSupported) {
      return;
    }

    const meta = event?.detail?.meta || {};
    const versionFromEvent = typeof meta.version === "number" ? meta.version : null;

    if (versionFromEvent !== null && versionFromEvent === state.lastSnapshotVersion) {
      return;
    }

    scheduleSnapshot(meta.reason || event?.type || "store:change");
  }

  function handleHistoryEvent(event) {
    if (state.initialising || state.disposed || !persistenceSupported) {
      return;
    }

    scheduleCheckpoint(event?.type || "history:change");
  }

  async function restoreLastSession() {
    if (!persistenceSupported) {
      try {
        await ensureProjectId();
      } catch (error) {
        console.warn("[M8Photo] Unable to assign project identifier without persistence", error);
      }
      state.initialising = false;
      deferred.resolve(false);
      return;
    }

    try {
      const lastProjectId = await getLastProjectId();
      let restored = false;

      if (lastProjectId) {
        const [snapshotRecord, checkpointRecord] = await Promise.all([
          getLatestSnapshot(lastProjectId),
          getLatestCheckpoint(lastProjectId),
        ]);

        if (snapshotRecord?.state) {
          store.replace(snapshotRecord.state, { reason: "autosave:restore" });
          restored = true;
          state.projectId = snapshotRecord.projectId;
        }

        if (checkpointRecord?.history && typeof history.importState === "function") {
          try {
            history.importState(checkpointRecord.history, { reason: "autosave:restore" });
          } catch (error) {
            console.warn("[M8Photo] Unable to hydrate history from checkpoint", error);
          }
        }
      } else {
        state.projectId = store.getState()?.project?.id || null;
      }

      const ensuredId = await ensureProjectId();
      const liveState = store.getState();
      const meta = selectProjectMetadata(liveState);

      if (ensuredId && persistenceSupported) {
        try {
          await touchProject(ensuredId, {
            markAsLast: true,
            lastOpenedAt: Date.now(),
            name: meta.name,
            description: meta.description,
            metadata: meta.metadata,
          });
        } catch (error) {
          console.warn("[M8Photo] Unable to update project metadata after restore", error);
        }
      }

      state.lastSnapshotVersion = typeof store.version === "number" ? store.version : null;
      const exportedHistory = history.exportState();
      state.lastCheckpointSignature = buildHistorySignature(exportedHistory);

      state.initialising = false;
      deferred.resolve(restored);
    } catch (error) {
      state.initialising = false;
      deferred.reject(error);
      console.warn("[M8Photo] Autosave restore failed", error);
    }
  }

  if (eventBus && typeof eventBus.on === "function") {
    cleanupTasks.push(eventBus.on("store:change", handleStoreChange));

    [
      "history:execute",
      "history:undo",
      "history:redo",
      "history:clear",
      "history:truncate",
      "history:coalesced",
      "history:overflow",
      "history:configure",
      "history:hydrate",
    ].forEach((eventName) => {
      cleanupTasks.push(eventBus.on(eventName, handleHistoryEvent));
    });
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    const visibilityHandler = async () => {
      if (document.hidden) {
        try {
          await flush("autosave:visibility");
        } catch (error) {
          console.warn("[M8Photo] Autosave flush on visibility change failed", error);
        }
      }
    };

    document.addEventListener("visibilitychange", visibilityHandler);
    cleanupTasks.push(() => document.removeEventListener("visibilitychange", visibilityHandler));
  }

  restoreLastSession();

  async function destroy() {
    if (state.disposed) {
      return;
    }

    state.disposed = true;
    clearSnapshotTimer();
    clearCheckpointTimer();

    while (cleanupTasks.length) {
      const task = cleanupTasks.pop();
      try {
        if (typeof task === "function") {
          task();
        }
      } catch (error) {
        console.warn("[M8Photo] Autosave cleanup task failed", error);
      }
    }
  }

  return {
    ready: deferred.promise,
    flush,
    destroy,
    isSupported: persistenceSupported,
  };
}
