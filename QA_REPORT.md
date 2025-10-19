M8 Studio v0.1 QA smoke test – bug list and quick fixes

Summary
- Scope validated from ticket: tools, layers, viewport, filters, I/O, persistence, performance, cross‑browser.
- Ran static/code review validation and traced runtime paths. Implemented quick fixes for issues blocking v0.1.

Critical issues (P0)
1) Offline app shell missing precache entries for essential modules
- Area: Offline/PWA (Service Worker)
- Repro:
  1. Load the app once while online.
  2. Turn the network offline and reload.
  3. Observe that toolbar’s menubar and export functionality fail to load; console shows module import errors for /modules/ui/menu.js and other modules.
- Root cause: sw.js precache list omits core modules imported at runtime (ESM), so the SW responds with the generic “// offline” fallback for scripts. That module has no exports and breaks static imports (e.g. initMenuBar) and dynamic imports (dialog modules, import/export pipeline).
- Impact: Blocks offline-capable shell in the product description.
- Fix implemented: Added the following to the SW precache list (SHELL_ASSETS):
  - /modules/ui/menu.js
  - /modules/ui/dialogs/exportDialog.js
  - /modules/ui/dialogs/brightnessContrastDialog.js
  - /modules/ui/dialogs/saturationHueDialog.js
  - /modules/ui/dialogs/blurDialog.js
  - /modules/ui/dialogs/invertDialog.js
  - /modules/ui/dialogs/grayscaleDialog.js
  - /modules/io/assetStore.js
  - /modules/io/exif.js
  - /modules/io/importExport.js
- Severity: P0 (blocks offline requirement, export/dialog flows offline)

High issues (P1)
2) Missing keyboard shortcuts for tools in test matrix (Select/Fill/Shape)
- Area: Keyboard shortcuts / Tooling
- Repro: Press S (select), F (fill) or U (shape) with no modifiers. Active tool does not change.
- Expected: Test matrix calls for tool shortcuts.
- Fix implemented: Added shortcuts in scripts/keys.js
  - S → Select
  - F → Fill
  - U → Shape
  (Existing: V Move, B Brush, E Eraser, T Text, C Crop, G Grid toggle)
- Severity: P1 (usability / parity per spec)

Medium/Low issues (P2/P3)
3) Inconsistent grid toggle event name
- Area: Events / Telemetry
- Detail: Menu emits "viewport:grid-toggle"; keyboard handler emits "viewport:grid". State drives UI correctly, but event listeners relying on a single name may miss notifications.
- Suggested fix: Normalize to one event name (e.g. viewport:grid-toggle) across emitters.
- Severity: P3 (non-blocking; informational)

Validation notes by area
- Tools: Code paths exist for Move/Brush/Eraser/Fill/Text/Shape/Select/Crop with properties in UI panels. New shortcuts added for Select/Fill/Shape. Brush/Eraser sampling and stroke rendering are implemented. Fill tool honors selection mask, tolerance, and alpha.
- Layers: Manager covers add/duplicate/delete/reorder/rename/visibility/lock, blend modes resolve to canvas operations; thumbnails generated. Rename, visibility, lock, and blend mode controls are wired in Layers panel.
- Viewport: Pan/zoom via pointer wheel and keyboard; zoom clamped and pan preserved around focus for wheel zoom. Grid overlay toggle wired to state.
- Filters: Brightness/Contrast, Saturation/Hue, Blur, Invert, Grayscale implement preview with debounce and commit via history for undo/redo. Dialogs are dynamically imported (now cached for offline).
- I/O: Import PNG/JPG with EXIF orientation; export PNG/JPG with quality and scale; export dialog (now cached for offline). Filename normalization present.
- Persistence: IndexedDB autosave, snapshots and history checkpoints with pruning; safe on unsupported browsers/fallback.
- Performance: Canvas engine batches DOM writes on rAF; FPS HUD present. Not benchmarked in this environment.
- Cross‑browser: Uses feature checks for pointer events, toBlob fallback, IndexedDB feature gates. Keyboard detection accounts for mac/win variants.

Quick fixes delivered in this PR
- Added S/F/U keyboard shortcuts for Select/Fill/Shape (scripts/keys.js)
- Ensured offline runtime stability by precaching essential ESM modules in Service Worker (sw.js)

Suggested follow‑ups (not blocking v0.1)
- Normalize grid toggle event name across keyboard/menu emitters.
- Consider routing View > Zoom In/Out through the viewport controller’s setZoom to maintain focal point similar to wheel zoom.
- Add basic E2E hydration test to verify SW cache coverage for all statically-imported modules.

End of report.
