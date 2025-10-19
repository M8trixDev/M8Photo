import { showFilterDialog } from "./filterDialogBase.js";

export function showBrightnessContrastDialog({ initial = {}, onChange, onApply, onCancel } = {}) {
  const controls = [
    { id: "brightness", label: "Brightness", type: "range", min: -100, max: 100, step: 1, value: initial.brightness ?? 0, format: (v) => `${v}` },
    { id: "contrast", label: "Contrast", type: "range", min: -100, max: 100, step: 1, value: initial.contrast ?? 0, format: (v) => `${v}` },
  ];
  return showFilterDialog({ title: "Brightness / Contrast", controls, initial, onChange, onApply, onCancel });
}
