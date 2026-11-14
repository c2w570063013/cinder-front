# 燼原戰線 Cinder Front — macOS app

A native Swift/AppKit shell that hosts the Vite web build in a `WKWebView`. No Xcode project:
`mac/build.sh` compiles the Swift sources with `swiftc`, draws the icon in code, assembles the bundle
and ad-hoc signs it.

## Build and run

```bash
mac/build.sh
```

```bash
open build/CinderFront.app
```

The app lands at **`build/CinderFront.app`** (double-clickable; Finder shows it as 燼原戰線 / Cinder Front
depending on the system language). Requirements: Xcode command-line toolchain (`swiftc`, `iconutil`,
`codesign`) and Node (for the web build). Apple Silicon, macOS 13 or later.

| Option | Effect |
| --- | --- |
| `--debug` | Debug build: Web Inspector enabled (right-click ▸ Inspect Element, or Safari ▸ Develop), ⌘R reloads the page |
| `--universal` | arm64 + x86_64 fat binary (default is arm64 only) |
| `--skip-web` | Reuse the existing `dist/` and only rebuild the native shell |
| `--run` | Launch the app when the build finishes |

Web Inspector can also be switched on for a release build without rebuilding:
`CINDER_DEBUG=1 build/CinderFront.app/Contents/MacOS/CinderFront`.

## After changing the web code

Run `mac/build.sh` again — it re-runs the web build and recreates the bundle from scratch (idempotent).
It first tries `npm run build` (typecheck + bundle); if the typecheck fails it falls back to
`npx vite build` and says so in the summary line (`web: …`). The web build is copied into
`Contents/Resources/web`.

## What the shell does

- **Loading** — the web build is served to the web view through a custom scheme,
  `cinder://app/index.html` (`WKURLSchemeHandler` with real MIME types), not `file://`.
  Navigation to anything else is blocked; a clicked `http(s)` link opens in the default browser.
  Remote subresources (`http`, `https`, `ws`, `wss`, `ftp`) are blocked by a content rule list — the game is local-only.
- **Window** — resizable, default 1440×900 (or the screen, if smaller), minimum 1024×640, frame remembered
  between launches, dark `#0b0d10` background so there is no white flash, native full screen.
- **Menu** — 燼原戰線 (About / Services / Hide / Quit ⌘Q), 編輯 (Undo, Redo, Cut, Copy, Paste, Select All),
  顯示方式 (Full Screen ⌃⌘F, Actual Size ⌘0, Zoom In ⌘=, Zoom Out ⌘- — scales the whole interface, remembered),
  視窗 (Minimize ⌘M, Zoom, Close ⌘W — closing the window quits), 輔助說明.
- **Input** — the web view is first responder; unhandled keys do not beep. WebKit's own pinch-zoom,
  back/forward swipe, smart zoom, link previews, context menu, drag ghosts and text selection are off.
  Trackpad pinch is re-emitted to the page as `wheel` events with `ctrlKey: true` (same as Chromium),
  zoom factor = `exp(-deltaY / 100)`.
- **Audio** — autoplay without a user gesture is allowed (`mediaTypesRequiringUserActionForPlayback = []`).
- **Performance** — App Nap / timer throttling is disabled while the window is visible.
- `alert()` / `confirm()` from the page appear as native sheets.

### `window.cinderNative` (injected at document start)

```ts
interface CinderNative {
  readonly isNative: true;
  readonly platform: 'macos';
  readonly version: string;      // CFBundleShortVersionString
  readonly debug: boolean;
  readonly isFullscreen: boolean;
  toggleFullscreen(): void;
  setFullscreen(on: boolean): void;
  quit(): void;
  log(...args: unknown[]): void; // prints to the app's stderr
}
```

Events dispatched on `window`:

- `cinder:fullscreen` — `detail: { fullscreen: boolean }` whenever the window enters or leaves full screen.
- `cinder:help` (cancelable) — Help menu item chosen. Call `preventDefault()` to show in-game help;
  otherwise a small native controls sheet is shown.

In a normal browser `window.cinderNative` is `undefined`, so guard with `window.cinderNative?.…`.
Uncaught JS errors and unhandled rejections are forwarded to the app's stderr as `js error: …`.

## Verifying a build

```bash
build/CinderFront.app/Contents/MacOS/CinderFront --selftest
```

Launches the app, waits for the page to report ready, runs checks inside the web view and prints one
`SELFTEST {json}` line (title, URL, page text, bridge, audio context state, speech voices, MIME / 404 /
remote-blocking checks, JS errors), then exits 0. Optional: `--out result.json`, `--snapshot page.png`
(a PNG of the web view), `--eval script.js` (extra async JS run in the page; its return value is added as `eval`).

```bash
codesign --verify --deep --strict --verbose=2 build/CinderFront.app
```

## Layout

```
mac/build.sh                  build script
mac/Sources/main.swift        entry point
mac/Sources/AppDelegate.swift window, menu, web view config, JS bridge, navigation policy, self-test
mac/Sources/SchemeHandler.swift  cinder:// → Resources/web
mac/Sources/GameWindow.swift  no-beep window, game-tuned WKWebView subclass
mac/icon/make_icon.swift      procedural app icon (CoreGraphics) → .iconset → iconutil → .icns
```

The app is ad-hoc signed (`codesign -s -`), which is enough to run on the Mac that built it. Sharing it with
other Macs would need a Developer ID signature and notarisation.
