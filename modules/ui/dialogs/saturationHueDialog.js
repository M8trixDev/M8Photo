import { showFilterDialog } from "./filterDialogBase.js";

export function showSaturationHueDialog({ initial = {}, onChange, onApply, onCancel } = {}) {
  const controls = [
    { id: "saturation", label: "Saturation", type: "range", min: -100, max: 100, step: 1, value: initial.saturation ?? 0, format: (v) => `${v}` },
    { id: "hue", label: "Hue", type: "range", min: -180, max: 180, step: 1, value: initial.hue ?? 0, format: (v) => `${v}°` },
  ];
  return showFilterDialog({ title: "Saturation / Hue", controls, initial, onChange, onApply, onCancel });
}
