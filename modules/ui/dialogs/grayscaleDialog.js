import { showFilterDialog } from "./filterDialogBase.js";

export function showGrayscaleDialog({ initial = {}, onChange, onApply, onCancel } = {}) {
  const controls = [
    { id: "amount", label: "Amount", type: "range", min: 0, max: 100, step: 1, value: initial.amount ?? 100, format: (v) => `${v}%` },
  ];
  return showFilterDialog({ title: "Grayscale", controls, initial, onChange, onApply, onCancel });
}
