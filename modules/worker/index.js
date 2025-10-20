// Worker pipeline stubs for future OffscreenCanvas painting
// This file intentionally provides a minimal API surface so the runtime can load even if workers are not used.

export function supportsOffscreenCanvas(){
  try { return typeof OffscreenCanvas !== 'undefined'; } catch (_) { return false; }
}

export function createPaintWorker(){
  // Placeholder; future versions will spin up a Worker and transfer an OffscreenCanvas
  return {
    postMessage(){ /* no-op */ },
    terminate(){ /* no-op */ },
  };
}
