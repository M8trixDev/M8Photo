import { showFilterDialog } from "./filterDialogBase.js";

export function showBlurDialog({ initial = {}, onChange, onApply, onCancel } = {}) {
  const controls = [
    { id: "radius", label: "Radius", type: "range", min: 0, max: 25, step: 0.5, value: initial.radius ?? 4, format: (v) => `${v.toFixed(1)} px` },
  ];
  return showFilterDialog({ title: "Gaussian Blur", controls, initial, onChange, onApply, onCancel });
}
