# M8 Studio

[![Version](https://img.shields.io/badge/version-v0.2.0-blue)](https://github.com/M8trixDev/M8Photo/releases/tag/v0.2.0) [![PWA](https://img.shields.io/badge/PWA-installable-success)](https://M8trixDev.github.io/M8Photo/)

Live: https://M8trixDev.github.io/M8Photo/

A calm, monochrome creative workspace. M8 Studio (also referred to in code as M8Photo Studio) is an offline‑first, installable Progressive Web App focused on precision editing with a grayscale aesthetic and gentle depth cues.

The app runs entirely in the browser using modern web platform APIs. No build step is required; serve the repository with a static file server and you are ready to explore the studio.


## Overview

- Monochrome-first UI designed for focus and legibility
- Responsive layout with toolbar, canvas workspace, and contextual panels
- Offline-capable app shell with an explicit offline page and cache-first strategy
- Session autosave and restore using IndexedDB
- Modular tools, layers, filters, and an accessible menubar


## What's new in v0.2.0

- Compact density mode across UI (default), with canvas filling the viewport beside a resizable right sidebar
- Left vertical tool palette with tooltips, active highlight, and full keyboard shortcuts
- Command palette (Ctrl/Cmd+K) and a shortcuts editor with conflict detection and persistence
- Selection overlays with marching ants and selection actions (select all, clear, fill) wired into history
- WebGL-accelerated filter path with Canvas2D fallback (invert, grayscale, hue/saturation, brightness/contrast; blur falls back)
- Eyedropper wired into the Color panel; Hand and Zoom tools map to pan/zoom (Alt or right-click to zoom out)
- Service worker polish: versioned caches and a “New version available” toast with one‑click reload
- Project format: native .m8s export/import (JSON + embedded assets)

## Tech stack

- HTML5 + ES Modules (no framework)
- Canvas 2D rendering for the workspace
- Service Worker + Web App Manifest for PWA install and offline support
- IndexedDB for autosave snapshots and history checkpoints
- Accessible ARIA menubar and keyboard navigation
- CSS custom properties and compact, grayscale theming


## Quick start

1. Serve the repository with any static file server (examples below).
   - Node: `npx serve . -l 3000` (or your preferred tool)
   - Python: `python3 -m http.server 3000`
2. Open http://localhost:3000 in a modern browser.
3. The service worker registers automatically; install the PWA from the browser menu if you want it pinned like a native app.

Tip: Browsers allow service workers on http://localhost, but not on file:// URLs. Always use a local server when testing.


## File structure

```
.
├─ index.html                # App shell
├─ offline.html              # Offline fallback page
├─ manifest.json             # PWA metadata and icons
├─ sw.js                     # Service worker (cache-first shell)
├─ assets/
│  ├─ icons/                 # Favicon and PWA icons
│  └─ template-thumbs/       # Placeholder thumbnails for templates
├─ styles/
│  ├─ theme.css              # Grayscale theme + variables
│  ├─ layout.css             # App shell layout
│  └─ components.css         # Toolbar, panels, lists, HUD, etc.
├─ scripts/
│  ├─ main.js                # Bootstraps app shell, viewport, SW
│  ├─ keys.js                # Global keyboard shortcuts
│  ├─ toolbar.js             # Branding + menubar + quick actions
│  └─ panels.js              # Renders side panels
└─ modules/
   ├─ core/                  # store.js, history.js, events.js, canvasEngine.js
   ├─ view/                  # viewport controller (pan/zoom + HUD + grid)
   ├─ tools/                 # move, brush, eraser, text, crop, fill, shape, select
   ├─ layers/                # layer manager, thumbnails, blend modes
   ├─ filters/               # brightness/contrast, saturation/hue, grayscale, invert, blur
   ├─ ui/                    # accessible menubar, dialogs, panels
   ├─ io/                    # import/export (PNG/JPEG, EXIF orientation), asset store
   ├─ persist/               # IndexedDB + autosave/restore logic
   └─ dev/                   # optional development harness (?devHarness=1)
```


## Features

- Workspace and viewport
  - Pixel-accurate canvas with pan/zoom, live zoom HUD, and optional grid overlay
  - Smooth, monochrome UI that emphasizes content without bright colors
- Tools
  - Move, Brush, Eraser, Text, Crop, Fill, Shape, and Select tools (with per-tool options)
  - Layer opacity shortcuts and history-integrated operations
- Layers and blending
  - Layer stack with reorder, lock/show, rename, duplicate, delete
  - Blending modes and per-layer opacity
  - Thumbnails for quick visual reference
- Filters and adjustments
  - Brightness/Contrast, Saturation/Hue, Grayscale, Invert, Gaussian Blur
  - Dialog-driven previews and undoable application to target layers
- Import and export
  - Import PNG/JPEG with EXIF orientation handling
  - Export PNG/JPEG with scale and quality options
- Offline and session continuity
  - Cache-first app shell with explicit offline page (offline.html)
  - Autosave snapshots and history checkpoints in IndexedDB; last session restores on launch
- Accessibility and keyboard navigation
  - ARIA menubar with full keyboard support, focus outlines, and reduced-motion respect


## Keyboard shortcuts

The app supports both macOS (Cmd) and Windows/Linux (Ctrl) conventions.

- Undo: Cmd/Ctrl+Z
- Redo: Cmd+Shift+Z (macOS) or Ctrl+Y (Windows/Linux)
- Zoom: Cmd/Ctrl+= to zoom in, Cmd/Ctrl+- to zoom out, Cmd/Ctrl+0 actual size
- Pan: Arrow keys to pan; hold Shift for larger steps
- Tools: V Move, B Brush, E Eraser, T Text, C Crop
- Selection: Cmd/Ctrl+A select all, Cmd/Ctrl+D deselect
- Selection actions: Shift+Delete clear, Shift+F5 fill
- Filters: Cmd/Ctrl+I Invert, Cmd/Ctrl+U Saturation/Hue, Cmd/Ctrl+Shift+B Brightness/Contrast, Cmd/Ctrl+Shift+G Grayscale, Cmd/Ctrl+Alt+B Blur
- Layer opacity: number keys set opacity (1=10%, 5=50%, 0=100%); two digits within ~350ms set exact value (e.g., 42 => 42%)


## Offline support

- Strategy: The service worker precaches the app shell and uses a cache‑first strategy for same‑origin GET requests. Navigations fall back to offline.html when the network is unavailable.
- Updates: On deploys that modify shell assets, bump the `CACHE_NAME` in sw.js to ensure clients update promptly. Browsers also refresh updated assets as they are navigated.
- Testing offline
  - Load the app once online so the shell is cached.
  - In DevTools, emulate “Offline,” then refresh. You should see the workspace shell or the offline page when appropriate.


## Development

- Running locally
  - Use any static server: `npx serve . -l 3000` or `python3 -m http.server 3000`
  - Open http://localhost:3000
  - Install the PWA if desired; the shell is installable via the browser menu
- Development harness
  - Append `?devHarness=1` to the URL to run the built‑in harness. It logs assertions to the console and resets state when complete.
- Serving notes
  - Always test through http://localhost (service workers do not work over file://)
  - If you are iterating on the service worker, consider unregistering it from DevTools Application > Service Workers, or bump `CACHE_NAME` in sw.js


## Testing checklist

- Keyboard shortcuts trigger the expected actions (undo/redo, zoom/pan, selection, tool switching, filters)
- Import a PNG/JPEG; verify EXIF orientation is respected
- Apply a filter; undo/redo works; preview updates before apply
- Export produces the expected PNG/JPEG with selected scale/quality
- Toggle the grid overlay from the View menu; zoom HUD updates as you zoom
- Reload the app; last session restores (project name, layers, viewport)
- Go offline after first load; confirm the shell works and offline.html appears for navigation fallback when appropriate


## Roadmap and known limitations

- Selection enhancements
  - Lasso tool (freehand selection) and polygonal selection
  - Feathering and refine‑edge controls
- Non‑destructive workflows
  - Adjustment layers and filter stacks
  - Per‑layer masks and clipping groups
- Tools
  - Transform tool with handles; multi‑select transforms
  - Pressure/tilt response for brush on supported hardware
- Import/Export
  - Basic RAW ingestion and color management; export presets
- Collaboration and sync
  - Optional cloud backup and cross‑device sync while preserving offline capability
- UI polish
  - Expanded “Compare” and “Share” quick actions (placeholders in the toolbar)

These items reflect planned enhancements. The current build focuses on a stable, monochrome app shell with core editing capabilities and robust offline behavior.


## Branding

M8 Studio embraces a monochrome, low‑contrast aesthetic that minimizes distraction. UI elements use neutral grays and soft shadows, keeping the focus on your image and supporting the product’s grayscale brand identity.
