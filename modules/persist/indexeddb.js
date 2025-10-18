const DB_NAME = "m8photo-workspace";
const DB_VERSION = 1;

const STORE_NAMES = {
  projects: "projects",
  snapshots: "snapshots",
  checkpoints: "checkpoints",
  metadata: "metadata",
};

const INDEX_NAMES = {
  projectSnapshots: "projectIdTimestamp",
  projectCheckpoints: "projectIdTimestamp",
};

const hasStructuredClone = typeof structuredClone === "function";

function cloneValue(value) {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  if (typeof value === "object" || Array.isArray(value)) {
    if (hasStructuredClone) {
      try {
        return structuredClone(value);
      } catch (error) {
        // Fall back to JSON cloning if structuredClone fails (e.g. unsupported types).
      }
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      console.warn("[M8Photo] Unable to clone value for persistence", error);
      return value;
    }
  }

  return value;
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    if (!request) {
      reject(new Error("Invalid IndexedDB request"));
      return;
    }

    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      { once: true }
    );

    request.addEventListener(
      "error",
      () => {
        reject(request.error || new Error("IndexedDB request failed"));
      },
      { once: true }
    );
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    if (!transaction) {
      reject(new Error("Invalid IndexedDB transaction"));
      return;
    }

    transaction.addEventListener(
      "complete",
      () => {
        resolve();
      },
      { once: true }
    );

    transaction.addEventListener(
      "error",
      () => {
        reject(transaction.error || new Error("IndexedDB transaction failed"));
      },
      { once: true }
    );

    transaction.addEventListener(
      "abort",
      () => {
        reject(transaction.error || new Error("IndexedDB transaction aborted"));
      },
      { once: true }
    );
  });
}

function normaliseProjectId(projectId) {
  if (typeof projectId === "string" && projectId.trim()) {
    return projectId.trim();
  }
  return null;
}

function buildRecordId(projectId, timestamp) {
  return `${projectId}:${timestamp}`;
}

let databasePromise = null;

export function isPersistenceSupported() {
  return typeof indexedDB !== "undefined";
}

export async function openDatabase() {
  if (!isPersistenceSupported()) {
    return null;
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      let resolved = false;

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.addEventListener("upgradeneeded", (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_NAMES.projects)) {
          const projects = db.createObjectStore(STORE_NAMES.projects, { keyPath: "id" });
          projects.createIndex("updatedAt", "updatedAt", { unique: false });
          projects.createIndex("lastOpenedAt", "lastOpenedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.snapshots)) {
          const snapshots = db.createObjectStore(STORE_NAMES.snapshots, { keyPath: "id" });
          snapshots.createIndex(INDEX_NAMES.projectSnapshots, ["projectId", "timestamp"], { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.checkpoints)) {
          const checkpoints = db.createObjectStore(STORE_NAMES.checkpoints, { keyPath: "id" });
          checkpoints.createIndex(INDEX_NAMES.projectCheckpoints, ["projectId", "timestamp"], { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.metadata)) {
          db.createObjectStore(STORE_NAMES.metadata, { keyPath: "key" });
        }
      });

      request.addEventListener("success", (event) => {
        const db = event.target.result;

        db.addEventListener("versionchange", () => {
          db.close();
          databasePromise = null;
        });

        resolved = true;
        resolve(db);
      });

      request.addEventListener("error", () => {
        if (!resolved) {
          console.warn("[M8Photo] Failed to open persistence database", request.error);
        }
        reject(request.error || new Error("IndexedDB open failed"));
      });

      request.addEventListener("blocked", () => {
        console.warn("[M8Photo] Persistence database upgrade is blocked");
      });
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  try {
    return await databasePromise;
  } catch (error) {
    console.warn("[M8Photo] Persistence database unavailable", error);
    return null;
  }
}

async function getDatabase() {
  return openDatabase();
}

async function runInTransaction(storeNames, mode, operation) {
  const db = await getDatabase();

  if (!db) {
    return null;
  }

  const transaction = db.transaction(storeNames, mode);
  const done = transactionDone(transaction);

  try {
    const result = await operation(transaction);
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch (abortError) {
      // Ignore additional abort errors.
    }
    throw error;
  }
}

export async function setLastProjectId(projectId) {
  const id = normaliseProjectId(projectId);
  const db = await getDatabase();

  if (!db) {
    return null;
  }

  const transaction = db.transaction([STORE_NAMES.metadata], "readwrite");
  const done = transactionDone(transaction);
  const metadataStore = transaction.objectStore(STORE_NAMES.metadata);
  const now = Date.now();

  if (!id) {
    metadataStore.delete("lastProjectId");
  } else {
    metadataStore.put({ key: "lastProjectId", value: id, updatedAt: now });
  }

  await done;
  return id;
}

export async function getLastProjectId() {
  const db = await getDatabase();

  if (!db) {
    return null;
  }

  const transaction = db.transaction([STORE_NAMES.metadata], "readonly");
  const done = transactionDone(transaction);
  const metadataStore = transaction.objectStore(STORE_NAMES.metadata);

  const record = await promisifyRequest(metadataStore.get("lastProjectId"));
  await done;

  if (record && typeof record.value === "string") {
    return record.value;
  }

  return null;
}

export async function touchProject(projectId, updates = {}) {
  const id = normaliseProjectId(projectId);

  if (!id) {
    return null;
  }

  const db = await getDatabase();

  if (!db) {
    return null;
  }

  return runInTransaction([STORE_NAMES.projects, STORE_NAMES.metadata], "readwrite", async (transaction) => {
    const projectsStore = transaction.objectStore(STORE_NAMES.projects);
    const metadataStore = transaction.objectStore(STORE_NAMES.metadata);
    const now = Date.now();

    const existing = (await promisifyRequest(projectsStore.get(id))) || {};
    const record = { id, createdAt: existing.createdAt || now, ...existing };
    record.updatedAt = now;

    if (typeof updates.lastOpenedAt === "number") {
      record.lastOpenedAt = updates.lastOpenedAt;
    } else if (updates.markAsLast) {
      record.lastOpenedAt = now;
    }

    if (typeof updates.name === "string" && updates.name.trim()) {
      record.name = updates.name.trim();
    }

    if (typeof updates.description === "string") {
      record.description = updates.description;
    }

    if (updates.metadata && typeof updates.metadata === "object" && updates.metadata !== null) {
      record.metadata = { ...(record.metadata || {}), ...cloneValue(updates.metadata) };
    }

    await promisifyRequest(projectsStore.put(record));

    if (updates.markAsLast) {
      metadataStore.put({ key: "lastProjectId", value: id, updatedAt: now });
    }

    return record;
  });
}

function extractProjectDetailsFromState(state) {
  if (!state || typeof state !== "object") {
    return {};
  }

  const project = state.project || {};
  return {
    name: typeof project.name === "string" ? project.name : undefined,
    description: typeof project.description === "string" ? project.description : undefined,
    metadata: project.metadata && typeof project.metadata === "object" ? project.metadata : undefined,
  };
}

export async function saveProjectSnapshot({ projectId, state, version, reason }) {
  const id = normaliseProjectId(projectId);

  if (!id) {
    throw new TypeError("Project snapshot requires a valid projectId");
  }

  const db = await getDatabase();

  if (!db) {
    return null;
  }

  const timestamp = Date.now();
  const snapshotRecord = {
    id: buildRecordId(id, timestamp),
    projectId: id,
    timestamp,
    version: typeof version === "number" ? version : null,
    reason: typeof reason === "string" ? reason : null,
    state: cloneValue(state),
  };

  const projectDetails = extractProjectDetailsFromState(state);

  return runInTransaction([STORE_NAMES.snapshots, STORE_NAMES.projects, STORE_NAMES.metadata], "readwrite", async (transaction) => {
    const snapshotsStore = transaction.objectStore(STORE_NAMES.snapshots);
    const projectsStore = transaction.objectStore(STORE_NAMES.projects);
    const metadataStore = transaction.objectStore(STORE_NAMES.metadata);
    const now = Date.now();

    await promisifyRequest(snapshotsStore.put(snapshotRecord));

    const existing = (await promisifyRequest(projectsStore.get(id))) || {};
    const projectRecord = { id, createdAt: existing.createdAt || now, ...existing };
    projectRecord.updatedAt = now;
    projectRecord.lastSnapshotAt = timestamp;
    projectRecord.lastSnapshotId = snapshotRecord.id;
    projectRecord.lastSnapshotVersion = snapshotRecord.version;

    if (projectDetails.name) {
      projectRecord.name = projectDetails.name;
    }

    if (typeof projectDetails.description === "string") {
      projectRecord.description = projectDetails.description;
    }

    if (projectDetails.metadata && typeof projectDetails.metadata === "object") {
      projectRecord.metadata = { ...(projectRecord.metadata || {}), ...cloneValue(projectDetails.metadata) };
    }

    await promisifyRequest(projectsStore.put(projectRecord));
    metadataStore.put({ key: "lastProjectId", value: id, updatedAt: now });

    return snapshotRecord;
  });
}

export async function saveHistoryCheckpoint({ projectId, checkpoint, version, reason }) {
  const id = normaliseProjectId(projectId);

  if (!id) {
    throw new TypeError("History checkpoint requires a valid projectId");
  }

  if (!checkpoint || typeof checkpoint !== "object") {
    throw new TypeError("History checkpoint payload must be an object");
  }

  const db = await getDatabase();

  if (!db) {
    return null;
  }

  const timestamp = Date.now();
  const checkpointRecord = {
    id: buildRecordId(id, timestamp),
    projectId: id,
    timestamp,
    version: typeof version === "number" ? version : null,
    reason: typeof reason === "string" ? reason : null,
    pointer: typeof checkpoint.pointer === "number" ? checkpoint.pointer : null,
    history: cloneValue(checkpoint),
  };

  return runInTransaction([STORE_NAMES.checkpoints, STORE_NAMES.projects, STORE_NAMES.metadata], "readwrite", async (transaction) => {
    const checkpointsStore = transaction.objectStore(STORE_NAMES.checkpoints);
    const projectsStore = transaction.objectStore(STORE_NAMES.projects);
    const metadataStore = transaction.objectStore(STORE_NAMES.metadata);
    const now = Date.now();

    await promisifyRequest(checkpointsStore.put(checkpointRecord));

    const existing = (await promisifyRequest(projectsStore.get(id))) || {};
    const projectRecord = { id, createdAt: existing.createdAt || now, ...existing };
    projectRecord.updatedAt = now;
    projectRecord.lastCheckpointAt = timestamp;
    projectRecord.lastCheckpointId = checkpointRecord.id;

    await promisifyRequest(projectsStore.put(projectRecord));
    metadataStore.put({ key: "lastProjectId", value: id, updatedAt: now });

    return checkpointRecord;
  });
}

async function getLatestRecord(storeName, indexName, projectId) {
  const id = normaliseProjectId(projectId);

  if (!id) {
    return null;
  }

  const db = await getDatabase();

  if (!db) {
    return null;
  }

  return runInTransaction([storeName], "readonly", async (transaction) => {
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
    const request = index.openCursor(range, "prev");

    const record = await new Promise((resolve, reject) => {
      request.addEventListener(
        "success",
        (event) => {
          const cursor = event.target.result;
          if (cursor) {
            resolve(cursor.value);
          } else {
            resolve(null);
          }
        },
        { once: false }
      );

      request.addEventListener(
        "error",
        () => {
          reject(request.error || new Error("IndexedDB cursor failed"));
        },
        { once: true }
      );
    });

    return cloneValue(record);
  });
}

export async function getLatestSnapshot(projectId) {
  return getLatestRecord(STORE_NAMES.snapshots, INDEX_NAMES.projectSnapshots, projectId);
}

export async function getLatestCheckpoint(projectId) {
  return getLatestRecord(STORE_NAMES.checkpoints, INDEX_NAMES.projectCheckpoints, projectId);
}

async function pruneStoreRecords(storeName, indexName, projectId, limit) {
  const id = normaliseProjectId(projectId);

  if (!id || typeof limit !== "number" || limit < 0) {
    return;
  }

  const db = await getDatabase();

  if (!db) {
    return;
  }

  await runInTransaction([storeName], "readwrite", async (transaction) => {
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
    const request = index.openCursor(range, "prev");

    await new Promise((resolve, reject) => {
      let count = 0;

      request.addEventListener(
        "success",
        (event) => {
          const cursor = event.target.result;

          if (!cursor) {
            resolve();
            return;
          }

          count += 1;

          if (count > limit) {
            cursor.delete();
          }

          cursor.continue();
        },
        { once: false }
      );

      request.addEventListener(
        "error",
        () => {
          reject(request.error || new Error("IndexedDB pruning failed"));
        },
        { once: true }
      );
    });
  });
}

export async function pruneSnapshots(projectId, limit) {
  return pruneStoreRecords(STORE_NAMES.snapshots, INDEX_NAMES.projectSnapshots, projectId, limit);
}

export async function pruneCheckpoints(projectId, limit) {
  return pruneStoreRecords(STORE_NAMES.checkpoints, INDEX_NAMES.projectCheckpoints, projectId, limit);
}
