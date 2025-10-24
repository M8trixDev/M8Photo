# Changelog

All notable changes to M8 Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2024-10-24

### Added

#### UI and Layout
- **Compact density mode** across the entire UI, now the default mode
- Canvas now fills the viewport beside a **resizable right sidebar**
- **Left vertical tool palette** with tooltips, active state highlights, and full keyboard shortcuts
- **Command palette** (Ctrl/Cmd+K) for quick access to all actions
- **Shortcuts editor** with conflict detection and persistence for customizable keyboard shortcuts

#### Tools and Editing
- **Selection overlays** with animated marching ants effect
- **Selection actions**: select all, clear, fill (wired into history)
- **Eyedropper tool** integrated with the Color panel for precise color sampling
- **Hand tool** for panning the canvas (spacebar or H key)
- **Zoom tool** for zooming in/out (Alt or right-click to zoom out)
- All tool operations now properly integrated with the history/undo system

#### Filters and Effects
- **WebGL-accelerated filter pipeline** with automatic Canvas2D fallback
- Filter support:
  - Invert (Cmd/Ctrl+I)
  - Grayscale (Cmd/Ctrl+Shift+G)
  - Hue/Saturation adjustment (Cmd/Ctrl+U)
  - Brightness/Contrast (Cmd/Ctrl+Shift+B)
  - Gaussian Blur (Cmd/Ctrl+Alt+B) with Canvas2D fallback

#### Project Management
- **Native .m8s format** for project export/import
- Projects save as JSON with embedded assets
- Full project state preservation including layers, history, and viewport settings

#### Progressive Web App (PWA)
- **Service worker with cache versioning** for reliable offline support
- **"New version available" toast notification** with one-click reload
- Automatic update detection with periodic background checks
- Installable as a Progressive Web App on all modern browsers
- Offline-first architecture with cache-first strategy
- Dedicated offline fallback page

### Improved
- Enhanced keyboard shortcut system across all tools and actions
- Layer opacity shortcuts using number keys (1-0 for 10%-100%)
- Two-digit opacity input (type 42 within ~350ms for 42% opacity)
- More responsive canvas workspace with optimized rendering
- Better focus management and accessibility throughout the UI
- Refined grayscale aesthetic with improved contrast and depth cues

### Technical
- Modular architecture with ES Modules (no build step required)
- IndexedDB for autosave snapshots and history checkpoints
- ARIA menubar with full keyboard navigation support
- Respects prefers-reduced-motion for accessibility
- EXIF orientation handling for imported images
- Development harness available via ?devHarness=1 query parameter

### Fixed
- Session state restoration on app launch
- Various edge cases in tool switching and history management
- Canvas rendering performance improvements
- Cross-browser compatibility issues

---

## [0.1.0] - Initial Release

### Added
- Initial app shell and workspace
- Basic canvas rendering engine
- Core tools: Move, Brush, Eraser, Text, Crop, Fill, Shape
- Layer management system with blend modes
- Basic import/export (PNG/JPEG)
- Offline support with service worker
- Autosave and session restoration
- Keyboard shortcuts for common operations
- Monochrome UI theme with focus on legibility

