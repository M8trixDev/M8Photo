export const DEFAULT_VIEWPORT_STATE = {
  scale: 1,
  translation: { x: 0, y: 0 },
  rotation: 0,
  rotationOrigin: { x: 0, y: 0 },
  grid: {
    visible: false,
    spacing: 64,
    accentEvery: 4,
    strokeStyle: "rgba(255, 255, 255, 0.08)",
    accentStyle: "rgba(255, 255, 255, 0.14)",
  },
  constraints: {
    minScale: 0.1,
    maxScale: 12,
  },
  viewportSize: { width: 0, height: 0 },
};

export function deriveViewportState(baseState = {}) {
  const state = {
    ...DEFAULT_VIEWPORT_STATE,
    ...baseState,
    translation: {
      ...DEFAULT_VIEWPORT_STATE.translation,
      ...(baseState.translation || {}),
    },
    grid: {
      ...DEFAULT_VIEWPORT_STATE.grid,
      ...(baseState.grid || {}),
    },
    constraints: {
      ...DEFAULT_VIEWPORT_STATE.constraints,
      ...(baseState.constraints || {}),
    },
    viewportSize: {
      ...DEFAULT_VIEWPORT_STATE.viewportSize,
      ...(baseState.viewportSize || {}),
    },
    rotationOrigin: {
      ...DEFAULT_VIEWPORT_STATE.rotationOrigin,
      ...(baseState.rotationOrigin || {}),
    },
  };

  return state;
}
