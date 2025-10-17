# M8Photo

A progressive web app shell prototype for the M8Photo creative workspace. The interface ships with a grayscale corporate theme, responsive layout, and offline-ready core assets so the shell stays available even without connectivity.

## Getting started

1. Serve the repository directory with any static file server (for example `npx serve .` or your preferred tooling).
2. Open `http://localhost:3000` (or the port used by your server) in a modern browser.
3. Install the PWA via the browser menu to pin the workspace shell.

> **Tip:** When testing service worker behaviour locally, serve over `https` or use a tool that enables service worker support on `http://localhost`.

## Features

- Monotone corporate styling with soft depth cues and smooth transitions.
- Toolbar, canvas workspace, and contextual panels arranged with adaptive flex/grid layout.
- Service worker precaching for app shell assets and offline fallback messaging.
- Web App Manifest with installable metadata and icon placeholders.
