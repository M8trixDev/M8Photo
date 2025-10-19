import { store } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";
import { layerManager } from "../layers/layerManager.js";
import * as assetStore from "../io/assetStore.js";

import * as brightnessContrast from "./brightnessContrast.js";
import * as saturationHue from "./saturationHue.js";
import * as blur from "./blur.js";
import * as invert from "./invert.js";
import * as grayscale from "./grayscale.js";

const FILTERS = {
  brightnessContrast: {
    title: "Brightness / Contrast",
    apply: brightnessContrast.applyToCanvas,
    initial: { brightness: 0, contrast: 0 },
    dialog: async () => (await import("../ui/dialogs/brightnessContrastDialog.js")).showBrightnessContrastDialog,
  },
  saturationHue: {
    title: "Saturation / Hue",
    apply: saturationHue.applyToCanvas,
    initial: { saturation: 0, hue: 0 },
    dialog: async () => (await import("../ui/dialogs/saturationHueDialog.js")).showSaturationHueDialog,
  },
  blur: {
    title: "Gaussian Blur",
    apply: blur.applyToCanvas,
    initial: { radius: 4 },
    dialog: async () => (await import("../ui/dialogs/blurDialog.js")).showBlurDialog,
  },
  invert: {
    title: "Invert",
    apply: invert.applyToCanvas,
    initial: { amount: 100 },
    dialog: async () => (await import("../ui/dialogs/invertDialog.js")).showInvertDialog,
  },
  grayscale: {
    title: "Grayscale",
    apply: grayscale.applyToCanvas,
    initial: { amount: 100 },
    dialog: async () => (await import("../ui/dialogs/grayscaleDialog.js")).showGrayscaleDialog,
  },
};

function getTargetLayerIds() {
  const state = store.getState();
  const selection = Array.isArray(state.selection?.items) ? state.selection.items.filter(Boolean) : [];
  const active = state.layers?.active || null;
  const all = selection.length ? selection : (active ? [active] : []);
  const entities = state.layers?.entities || {};
  // Only raster-like layers that have an image asset and are not locked
  return all.filter((id) => {
    const layer = entities[id];
    if (!layer) return false;
    if (layer.locked) return false;
    const assetId = layer?.metadata?.imageAssetId;
    return typeof assetId === "string" && assetId.trim() !== "";
  });
}

function safeGetCanvasForLayer(layerId) {
  const layer = store.getState().layers?.entities?.[layerId];
  const assetId = layer?.metadata?.imageAssetId;
  if (!assetId) return null;
  return assetStore.getCanvas(assetId);
}

function updateLayerAsset(layerId, assetId, meta = {}) {
  layerManager.updateLayer(layerId, { metadata: { imageAssetId: assetId } }, { source: meta.source || "filters" });
}

function registerHistoryCommand() {
  if (history.hasCommand("filters:apply")) return;
  history.registerCommand("filters:apply", ({ payload }) => {
    const type = payload?.type;
    const params = payload?.params || {};
    const layerIds = Array.isArray(payload?.layerIds) ? payload.layerIds.slice() : [];
    const providedAfter = payload?.afterAssetIds || null;

    const filter = FILTERS[type];
    if (!filter) throw new Error(`Unknown filter type: ${type}`);

    return {
      label: filter.title || "Filter",
      meta: { type, params: { ...params }, layerCount: layerIds.length },
      beforeAssetIds: null,
      afterAssetIds: null,
      execute() {
        const state = store.getState();
        const entities = state.layers?.entities || {};
        const befores = {};
        const afters = {};

        layerIds.forEach((id) => {
          const layer = entities[id];
          if (!layer || layer.locked) return;
          const beforeId = layer?.metadata?.imageAssetId;
          if (!beforeId) return;
          befores[id] = beforeId;

          let targetAssetId = providedAfter?.[id];
          if (!targetAssetId) {
            const srcCanvas = assetStore.getCanvas(beforeId);
            if (!srcCanvas) return;
            const resultCanvas = filter.apply(srcCanvas, params);
            targetAssetId = assetStore.registerCanvas(resultCanvas, { prefix: `${type}` });
          }

          afters[id] = targetAssetId;
          updateLayerAsset(id, targetAssetId, { source: "history" });
        });

        this.beforeAssetIds = befores;
        this.afterAssetIds = afters;
      },
      undo() {
        const ids = Object.keys(this.beforeAssetIds || {});
        ids.forEach((id) => {
          const assetId = this.beforeAssetIds[id];
          if (assetId) updateLayerAsset(id, assetId, { source: "history" });
        });
      },
      redo() {
        const ids = Object.keys(this.afterAssetIds || {});
        ids.forEach((id) => {
          const assetId = this.afterAssetIds[id];
          if (assetId) updateLayerAsset(id, assetId, { source: "history" });
        });
      },
    };
  });
}

function debounceRaf(fn) {
  let raf = 0;
  let lastArgs = null;
  const tick = () => {
    raf = 0;
    const args = lastArgs; lastArgs = null;
    try { fn.apply(null, args || []); } catch (e) { console.error(e); }
  };
  return (...args) => {
    lastArgs = args;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };
}

async function openFilterDialog(type) {
  const filter = FILTERS[type];
  if (!filter) return;

  const layerIds = getTargetLayerIds();
  if (!layerIds.length) {
    window.alert("Select a raster layer to apply the filter.");
    return;
  }

  registerHistoryCommand();

  const showDialogFactory = await filter.dialog();
  if (typeof showDialogFactory !== "function") return;

  const originals = {};
  const previews = {};

  layerIds.forEach((id) => {
    const ent = store.getState().layers.entities[id];
    originals[id] = ent?.metadata?.imageAssetId || null;
    previews[id] = null;
  });

  const cleanupPreviews = () => {
    // Revert any preview assets to originals
    Object.keys(originals).forEach((id) => {
      const orig = originals[id];
      const current = store.getState().layers.entities[id]?.metadata?.imageAssetId;
      if (orig && current && current !== orig) {
        updateLayerAsset(id, orig, { source: "filters" });
      }
    });
  };

  const removePreviewAssets = () => {
    Object.values(previews).forEach((assetId) => {
      if (assetId) {
        try { assetStore.remove(assetId); } catch (_) {}
      }
    });
  };

  const applyPreview = debounceRaf((params) => {
    const { live } = params || {};
    if (!live) {
      cleanupPreviews();
      return;
    }

    layerIds.forEach((id) => {
      const srcId = originals[id];
      const srcCanvas = srcId ? assetStore.getCanvas(srcId) : null;
      if (!srcCanvas) return;
      const resultCanvas = filter.apply(srcCanvas, params);
      const prevPreviewId = previews[id];
      const previewAssetId = assetStore.registerCanvas(resultCanvas, { prefix: `${type}-preview` });
      previews[id] = previewAssetId;
      updateLayerAsset(id, previewAssetId, { source: "filters" });
      if (prevPreviewId) {
        try { assetStore.remove(prevPreviewId); } catch (_) {}
      }
    });
  });

  const onChange = (params) => {
    applyPreview(params);
  };

  const onApply = async (params) => {
    // Ensure we revert preview to capture original state in history before images
    cleanupPreviews();

    // If we have preview assets, reuse them for history to avoid recomputation
    const afterAssetIds = {};
    Object.keys(previews).forEach((id) => {
      if (previews[id]) afterAssetIds[id] = previews[id];
    });

    await history.execute("filters:apply", {
      type,
      params,
      layerIds,
      afterAssetIds: Object.keys(afterAssetIds).length ? afterAssetIds : undefined,
    }, { meta: { source: "filters" } });

    // After commit, originals should update to these new assets
  };

  const onCancel = () => {
    cleanupPreviews();
    removePreviewAssets();
  };

  // Show the dialog
  showDialogFactory({ initial: { ...filter.initial }, onChange, onApply, onCancel });
}

export function initFilters() {
  // Register event handler for menu trigger
  eventBus.on("filter:apply", (event) => {
    const type = event?.detail?.type;
    if (!type) return;
    // Map legacy types if needed
    const map = {
      blur: "blur",
      invert: "invert",
      grayscale: "grayscale",
      brightnessContrast: "brightnessContrast",
      saturationHue: "saturationHue",
    };
    const resolved = map[type] || type;
    if (FILTERS[resolved]) {
      openFilterDialog(resolved);
    }
  });
}

export default { initFilters };
