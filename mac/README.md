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
  readonly net: NativeNetBridge;  // LAN transport, see below (src/core/api.ts)
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

## LAN transport — `window.cinderNative.net`

Implements `NativeNetBridge` from `src/core/api.ts` (`mac/Sources/NetBridge.swift`, Network.framework).
Results arrive on `window` as `CustomEvent('cinder:net', { detail: NativeNetEvent })`, on the main thread, in order.

- **Hosting** — `NWListener` on an OS-chosen TCP port, advertised over Bonjour as `_cinderfront._tcp`.
  The Bonjour instance name (`CinderFront-<10 hex>`, random per app launch) is the host `id` other machines see;
  the room name and `info` travel in the TXT record (`name`, `info`, `info1`…, so `info` may be up to ~1000 bytes).
  `updateInfo` republishes the TXT record without touching the listener or its port. `host()` while hosting restarts on a new port.
- **Browsing** — `NWBrowser`; our own advertisement is never reported (other instances on the same Mac are).
  `found` is re-sent with the same `id` whenever name or info changes; `lost` when the service goes away
  (≈ 1.1 s after a host process is killed, measured). `browse()` again reports every host afresh.
- **Connections** — TCP, no-delay, keepalive (idle 2 s, 3 probes 1 s apart) and a 6 s drop time for
  unacknowledged data; frames are a 4-byte big-endian length + UTF-8 text, ≤ 1 MiB (an oversize incoming frame
  drops the connection; an oversize `send` is refused with an `error` event and the connection stays). `conn`
  ids count up from 1 for the whole app run. At most 32 simultaneous connections; extra incoming ones are refused.
- **Page reload / navigation / web process crash** — everything is closed silently (no events reach the new page).

Details the contract leaves open:

| Situation | What you get |
| --- | --- |
| `close(conn)` | `closed` with `reason: 'local'` (queued sends are flushed first) |
| `reset()` | `closed` (`'local'`) for every open connection |
| peer closed / its process died | `closed` with `reason: 'remote'` (≈ 10 ms after `kill -9`, measured) |
| peer machine gone (sleep, cable, Wi-Fi) | `closed` with `'timeout'` or `'reset'` after ≈ 5–6 s (keepalive; not measured) |
| `connect()` to an unknown id | `closed` `{ conn: -1, hostId, reason: 'unknown host' }` immediately |
| `connect()` that does not get through in 8 s | `closed` `{ conn: -1, hostId, reason: 'timeout…' }` (also `'refused'`) |
| `send()` / `close()` on a closed or unknown conn | ignored (its `closed` was or will be sent) |
| local-network access denied | `error` with a zh-Hant message pointing to System Settings (repeats are suppressed for 3 s) |

TCP keepalive notices a vanished *machine*, not a peer *page* that hangs (its kernel still answers),
so the protocol on top should keep its own heartbeat / turn timeouts.

### Keeping the clock running in the background

While a room is hosted or any connection is open, the app holds an App Nap opt-out and turns off WebKit's
hidden-page throttling. Measured with `mac/test/background-ticks.js` (counts per second; this Mac's display gave ~37 rAF/s when visible):

| Window state | rAF, no LAN | timers (16 / 50 ms), no LAN | rAF, LAN open | timers (16 / 50 ms), LAN open |
| --- | --- | --- | --- | --- |
| visible | ~37 | 50 / 19.2 | ~37 | 50 / 19.2 |
| covered by another window | 0 | 1 / 1 | ~37 | 50 / 19.2 |
| minimised | 0 | 1 / 1 | **0** | 50 / 19.2 |
| app hidden (⌘H) | 0 | 1 / 1 | **0** | 50 / 19.2 |

So during a LAN session timers keep full rate in every state, but `requestAnimationFrame` stops when the
window is minimised or the app is hidden: the game loop must step the simulation from a timer when rAF stalls.

### What the player sees

- **Local network permission** (macOS 15 and later): the first `browse()` / `host()` / `connect()` can show a
  system dialog asking whether 燼原戰線 may find and connect to devices on the local network, with the
  explanation from `NSLocalNetworkUsageDescription`. If it is
  denied, discovery and connections to other Macs fail and the page gets the `error` event; the switch is in
  System Settings ▸ Privacy & Security ▸ Local Network.
- **Firewall** (when the macOS firewall is on): the first `host()` shows the firewall's dialog asking whether
  CinderFront may accept incoming network connections. Deny it and other Macs cannot join (connections from
  the same Mac still work).
- Both decisions are tied to the app's code signature. The build is ad-hoc signed, and every rebuild gets a new
  signature, so **a rebuilt app may ask again** (or the firewall may silently keep blocking an old entry; remove
  it in System Settings ▸ Network ▸ Firewall ▸ Options). A Developer ID signature would make the decisions stick.

### Testing the bridge on one Mac

```bash
mac/test/net-selftest.sh
```

Launches a hosting and a joining instance (`open -n`; launching the binary directly also allows several
instances). They exchange:

- 300 ping/pong round trips
- 300-message bursts both ways, with order checked
- a 1 MiB frame and hostile text (CJK, emoji, quotes, backslashes, U+2028, NUL, `</script>`), checked byte-exact
- an empty frame and an oversize send

Then the joiner closes, reconnects, and the script `kill -9`s the host, checking that `closed` and `lost` arrive. Prints a JSON report and `VERDICT: PASS`.

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
mac/Sources/NetBridge.swift   LAN transport (Bonjour + TCP) behind window.cinderNative.net
mac/test/                     two-instance bridge test, background-ticking measurement
mac/icon/make_icon.swift      procedural app icon (CoreGraphics) → .iconset → iconutil → .icns
```

The app is ad-hoc signed (`codesign -s -`), which is enough to run on the Mac that built it. Sharing it with
other Macs would need a Developer ID signature and notarisation.
