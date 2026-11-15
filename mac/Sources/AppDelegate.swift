import AppKit
import WebKit

private let kWindowAutosave = "CinderFrontMainWindow"
private let kPageZoomKey = "CinderPageZoom"
private let kBackground = NSColor(srgbRed: 11 / 255, green: 13 / 255, blue: 16 / 255, alpha: 1) // #0b0d10
private let kTitle = "燼原戰線 Cinder Front"

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  private var window: GameWindow!
  private var webView: GameWebView!
  private var schemeHandler: SchemeHandler!
  private var fullscreenItem: NSMenuItem?
  private var activity: NSObjectProtocol?
  private var bridgeMessages = 0
  private var selfTestStarted = false
  private var contentRulesActive = false
  private let net = NetBridge()
  private var netPending: [[String: Any]] = []
  private var netFlushScheduled = false
  private var netEventsDelivered = 0
  private var coverWindow: NSWindow?
  private var throttlingOff = false

  private let args = CommandLine.arguments
  private lazy var selfTest = args.contains("--selftest")
  private lazy var debugMode: Bool = {
    #if DEBUG
      return true
    #else
      return ProcessInfo.processInfo.environment["CINDER_DEBUG"] == "1" || UserDefaults.standard.bool(forKey: "CinderDebug")
    #endif
  }()

  private func argValue(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
  }

  private func log(_ s: String) {
    FileHandle.standardError.write(Data("[CinderFront] \(s)\n".utf8))
  }

  // MARK: - Launch

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.appearance = NSAppearance(named: .darkAqua)
    buildMenu()
    buildWindow()
    NSApp.activate(ignoringOtherApps: true)
    net.log = { [weak self] in self?.log($0) }
    net.emit = { [weak self] in self?.queueNetEvent($0) }
    net.onActivityChange = { [weak self] in self?.updateActivity() }

    // Block every remote subresource: the game is fully local.
    // (WebKit's rule regex has no alternation, hence one rule per scheme.)
    let rules = ["^https?:", "^wss?:", "^ftp:"]
      .map { #"{"trigger":{"url-filter":"\#($0)"},"action":{"type":"block"}}"# }
      .joined(separator: ",")
      .withBrackets()
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "cinder-local-only", encodedContentRuleList: rules) { [weak self] list, error in
      guard let self else { return }
      if let list {
        self.webView.configuration.userContentController.add(list)
        self.contentRulesActive = true
      } else if let error {
        self.log("content rules: \(error.localizedDescription)")
      }
      self.webView.load(URLRequest(url: SchemeHandler.indexURL))
    }

    if selfTest {
      // Never hang an automated run.
      DispatchQueue.main.asyncAfter(deadline: .now() + (args.contains("--eval") ? 180 : 25)) { [weak self] in
        self?.finishSelfTest(json: #"{"error":"timeout: page never reported ready"}"#, ok: false)
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

  // MARK: - Window + web view

  private func buildWindow() {
    let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    schemeHandler = SchemeHandler(root: webRoot)

    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(schemeHandler, forURLScheme: SchemeHandler.scheme)
    config.mediaTypesRequiringUserActionForPlayback = [] // game audio may start without a click
    config.websiteDataStore = .default() // localStorage (settings) persists between launches
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.defaultWebpagePreferences.allowsContentJavaScript = true
    if debugMode { config.preferences.setValue(true, forKey: "developerExtrasEnabled") }

    let ucc = config.userContentController
    ucc.add(self, name: "cinder")
    ucc.addUserScript(WKUserScript(source: shimSource(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    ucc.addUserScript(WKUserScript(source: Self.styleSource, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

    let frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
    webView = GameWebView(frame: frame, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsMagnification = false // the game handles pinch itself
    webView.allowsBackForwardNavigationGestures = false
    webView.allowsLinkPreview = false
    webView.autoresizingMask = [.width, .height]
    webView.allowInspectMenu = debugMode
    webView.setValue(false, forKey: "drawsBackground") // no white flash before the page paints
    webView.underPageBackgroundColor = kBackground
    if debugMode, #available(macOS 13.3, *) { webView.isInspectable = true }
    let zoom = UserDefaults.standard.double(forKey: kPageZoomKey)
    if zoom >= 0.5, zoom <= 2 { webView.pageZoom = zoom }

    window = GameWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = kTitle
    window.delegate = self
    window.isReleasedWhenClosed = false
    window.backgroundColor = kBackground
    window.contentMinSize = NSSize(width: 1024, height: 640)
    window.collectionBehavior = [.fullScreenPrimary]
    window.tabbingMode = .disallowed
    window.isRestorable = false
    window.contentView = webView

    if !window.setFrameUsingName(kWindowAutosave) {
      // First launch: 1440×900, or as much of the screen as there is.
      if let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame {
        let content = window.contentRect(forFrameRect: visible)
        window.setContentSize(NSSize(width: min(1440, content.width), height: min(900, content.height)))
      }
      window.center()
    }
    window.setFrameAutosaveName(kWindowAutosave)
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(webView)
    updateActivity()
  }

  // MARK: - JS bridge

  /// `window.cinderNative` — injected before any page script runs.
  private func shimSource() -> String {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    return """
    (() => {
      if (window.cinderNative) return;
      const post = (m) => { try { window.webkit.messageHandlers.cinder.postMessage(m); } catch (_) {} };
      const state = { fullscreen: false };
      const str = (v) => (v == null ? '' : String(v));
      const num = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : -1; };
      const netOp = (m) => post(Object.assign({ type: 'net' }, m));
      const errors = (window.__cinderErrors = []);
      window.cinderNative = Object.freeze({
        isNative: true,
        platform: 'macos',
        version: '\(version)',
        debug: \(debugMode ? "true" : "false"),
        get isFullscreen() { return state.fullscreen; },
        toggleFullscreen() { post({ type: 'toggleFullscreen' }); },
        setFullscreen(on) { post({ type: 'setFullscreen', on: !!on }); },
        quit() { post({ type: 'quit' }); },
        log(...a) { post({ type: 'log', text: a.map(String).join(' ') }); },
        // LAN transport (NativeNetBridge in src/core/api.ts); results arrive as 'cinder:net' events.
        net: Object.freeze({
          host(name, info) { netOp({ op: 'host', name: str(name), info: str(info) }); },
          updateInfo(info) { netOp({ op: 'updateInfo', info: str(info) }); },
          stopHost() { netOp({ op: 'stopHost' }); },
          browse() { netOp({ op: 'browse' }); },
          stopBrowse() { netOp({ op: 'stopBrowse' }); },
          connect(hostId) { netOp({ op: 'connect', hostId: str(hostId) }); },
          send(conn, text) { netOp({ op: 'send', conn: num(conn), text: str(text) }); },
          close(conn) { netOp({ op: 'close', conn: num(conn) }); },
          reset() { netOp({ op: 'reset' }); },
        }),
      });
      // native → page: batches of NativeNetEvents, dispatched in order
      window.__cinderNetDeliver = (list) => {
        for (const detail of list) window.dispatchEvent(new CustomEvent('cinder:net', { detail }));
      };
      // native → page: fullscreen changes arrive as a 'cinder:fullscreen' CustomEvent
      window.__cinderNativeState = (s) => {
        Object.assign(state, s);
        window.dispatchEvent(new CustomEvent('cinder:fullscreen', { detail: { fullscreen: state.fullscreen } }));
      };
      window.addEventListener('error', (e) => {
        const text = (e.message || 'error') + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '');
        errors.push(text); post({ type: 'error', text });
      });
      window.addEventListener('unhandledrejection', (e) => {
        const text = 'unhandled rejection: ' + (e.reason && e.reason.stack || e.reason);
        errors.push(text); post({ type: 'error', text });
      });
      window.addEventListener('DOMContentLoaded', () => post({ type: 'ready', title: document.title, href: location.href }));
      // The game owns right-click and dragging; never show WebKit's menu or drag ghosts.
      window.addEventListener('contextmenu', (e) => e.preventDefault(), true);
      window.addEventListener('dragstart', (e) => e.preventDefault(), true);
      // Trackpad pinch: WebKit reports GestureEvents; re-emit them as ctrl+wheel (the form Chromium uses,
      // zoom factor = exp(-deltaY / 100)) so the game needs only one zoom code path.
      let lastScale = 1;
      window.addEventListener('gesturestart', (e) => { lastScale = 1; e.preventDefault(); }, { capture: true, passive: false });
      window.addEventListener('gesturechange', (e) => {
        e.preventDefault();
        const ratio = e.scale / (lastScale || 1);
        lastScale = e.scale;
        if (!(ratio > 0) || ratio === 1) return;
        const target = document.elementFromPoint(e.clientX, e.clientY) || document.body;
        target.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -Math.log(ratio) * 100, deltaMode: 0, ctrlKey: true,
          clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true,
        }));
      }, { capture: true, passive: false });
      window.addEventListener('gestureend', (e) => e.preventDefault(), { capture: true, passive: false });
    })();
    """
  }

  private static let styleSource = """
  (() => {
    const s = document.createElement('style');
    s.textContent = 'html{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}' +
      'input,textarea,[contenteditable]{-webkit-user-select:text;user-select:text}';
    (document.head || document.documentElement).appendChild(s);
  })();
  """

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "cinder", message.frameInfo.isMainFrame,
          let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    bridgeMessages += 1
    switch type {
    case "net":
      net.handle(body)
    case "testWindow" where selfTest:
      testWindow(body["action"] as? String ?? "")
    case "toggleFullscreen":
      window.toggleFullScreen(nil)
    case "setFullscreen":
      let on = body["on"] as? Bool ?? false
      if on != window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
    case "quit":
      NSApp.terminate(nil)
    case "log":
      log("js: \(body["text"] as? String ?? "")")
    case "error":
      log("js error: \(body["text"] as? String ?? "")")
    case "ready":
      log("page ready: title=\"\(body["title"] as? String ?? "")\" url=\(body["href"] as? String ?? "")")
      if selfTest { DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.runSelfTest() } }
    default:
      break
    }
  }

  private func pushFullscreenState() {
    let on = window.styleMask.contains(.fullScreen)
    fullscreenItem?.title = on ? "離開全螢幕" : "進入全螢幕"
    webView.evaluateJavaScript("window.__cinderNativeState && window.__cinderNativeState({ fullscreen: \(on) })", completionHandler: nil)
  }

  // MARK: - Window delegate

  func windowDidEnterFullScreen(_ notification: Notification) { pushFullscreenState() }
  func windowDidExitFullScreen(_ notification: Notification) { pushFullscreenState() }
  func windowDidBecomeKey(_ notification: Notification) { window.makeFirstResponder(webView) }
  func windowDidChangeOcclusionState(_ notification: Notification) { updateActivity() }
  func windowDidMiniaturize(_ notification: Notification) { updateActivity() }
  func windowDidDeminiaturize(_ notification: Notification) { updateActivity() }

  /// While the game is on screen — or a LAN room / connection is open, because the host is the clock for
  /// every peer — opt out of App Nap / timer coalescing, and keep WebKit from treating the page as hidden.
  private func updateActivity() {
    guard window != nil else { return }
    let visible = window.occlusionState.contains(.visible) && !window.isMiniaturized
    let networked = net.isActive
    let wanted = visible || networked
    if wanted, activity == nil {
      activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical], reason: networked ? "LAN match in progress" : "Game is running")
    } else if !wanted, let a = activity {
      ProcessInfo.processInfo.endActivity(a)
      activity = nil
    }
    setBackgroundThrottling(enabled: !networked)
  }

  /// WebKit throttles a page it considers hidden: rAF stops, timers drop to ~1 Hz, the web content process
  /// may be App-Napped. During a LAN session none of that is acceptable. (Private but long-standing WebKit
  /// SPI, reached through KVC and guarded so a missing selector is simply skipped.)
  private func setBackgroundThrottling(enabled: Bool) {
    guard throttlingOff == enabled else { return } // already in the requested state
    throttlingOff = !enabled
    // Occlusion detection off ⇒ a covered window still counts as visible (rAF keeps running).
    setPrivate(webView, "windowOcclusionDetectionEnabled", enabled)
    let prefs = webView.configuration.preferences
    setPrivate(prefs, "hiddenPageDOMTimerThrottlingEnabled", enabled)
    setPrivate(prefs, "hiddenPageDOMTimerThrottlingAutoIncreases", enabled)
    setPrivate(prefs, "pageVisibilityBasedProcessSuppressionEnabled", enabled)
    if selfTest { log("background throttling \(enabled ? "on" : "off")") }
  }

  private func setPrivate(_ object: NSObject, _ key: String, _ value: Bool) {
    let setter = "_set" + key.prefix(1).uppercased() + key.dropFirst() + ":"
    guard object.responds(to: NSSelectorFromString(setter)) else { return log("note: \(type(of: object)) has no \(setter)") }
    object.setValue(value, forKey: key)
  }

  // MARK: - LAN events → page

  private func queueNetEvent(_ event: [String: Any]) {
    netPending.append(event)
    guard !netFlushScheduled else { return }
    netFlushScheduled = true
    DispatchQueue.main.async { [weak self] in self?.flushNetEvents() } // one script per run-loop turn
  }

  private func flushNetEvents() {
    netFlushScheduled = false
    guard !netPending.isEmpty else { return }
    let batch = netPending
    netPending.removeAll()
    // JSON is a JS expression, so the texts reach the page byte-exact without any manual escaping.
    guard let data = try? JSONSerialization.data(withJSONObject: batch), let json = String(data: data, encoding: .utf8) else {
      return log("net: could not encode \(batch.count) events")
    }
    netEventsDelivered += batch.count
    webView.evaluateJavaScript("window.__cinderNetDeliver && window.__cinderNetDeliver(\(json)); 0", completionHandler: nil)
  }

  /// The page that owned the sockets is going away: close them all without telling anyone.
  private func dropNetForNavigation() {
    if net.isActive || net.isBrowsing { log("net: page is navigating — closing \(net.openConnections) connection(s), hosting=\(net.isHosting)") }
    net.reset(silent: true)
    netPending.removeAll()
  }

  // MARK: - Navigation: local only

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme == SchemeHandler.scheme, url.host == SchemeHandler.host { return decisionHandler(.allow) }
    if scheme == "about" { return decisionHandler(.allow) }
    if scheme == "http" || scheme == "https", action.navigationType == .linkActivated {
      NSWorkspace.shared.open(url) // external links belong in the user's browser
    } else {
      log("blocked navigation to \(url.absoluteString)")
    }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, let s = url.scheme?.lowercased(), s == "http" || s == "https" { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { dropNetForNavigation() }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { log("navigation failed: \(error.localizedDescription)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { log("load failed: \(error.localizedDescription)") }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    log("web content process terminated — reloading")
    dropNetForNavigation()
    webView.load(URLRequest(url: SchemeHandler.indexURL))
  }

  // alert() / confirm() from the page as native sheets
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "好")
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "好")
    a.addButton(withTitle: "取消")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }

  // MARK: - Menu

  private func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command], target: AnyObject? = nil) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
    i.keyEquivalentModifierMask = mods
    i.target = target
    return i
  }

  private func buildMenu() {
    let name = "燼原戰線"
    let main = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      holder.submenu = menu
      main.addItem(holder)
      return menu
    }

    let services = NSMenuItem(title: "服務", action: nil, keyEquivalent: "")
    let servicesMenu = NSMenu(title: "服務")
    services.submenu = servicesMenu
    _ = add(name, [
      item("關於\(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      services,
      .separator(),
      item("隱藏\(name)", #selector(NSApplication.hide(_:)), "h"),
      item("隱藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("顯示全部", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("結束\(name)", #selector(NSApplication.terminate(_:)), "q"),
    ])
    NSApp.servicesMenu = servicesMenu

    _ = add("編輯", [
      item("還原", Selector(("undo:")), "z"),
      item("重做", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("剪下", #selector(NSText.cut(_:)), "x"),
      item("拷貝", #selector(NSText.copy(_:)), "c"),
      item("貼上", #selector(NSText.paste(_:)), "v"),
      item("全選", #selector(NSText.selectAll(_:)), "a"),
    ])

    let fs = item("進入全螢幕", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
    fullscreenItem = fs
    var viewItems: [NSMenuItem] = [
      fs,
      .separator(),
      item("實際大小", #selector(zoomReset(_:)), "0", target: self),
      item("放大", #selector(zoomIn(_:)), "=", target: self),
      item("縮小", #selector(zoomOut(_:)), "-", target: self),
    ]
    if debugMode {
      viewItems += [.separator(), item("重新載入", #selector(reloadPage(_:)), "r", target: self)]
    }
    _ = add("顯示方式", viewItems)

    let windowMenu = add("視窗", [
      item("縮到最小", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("縮放", #selector(NSWindow.performZoom(_:))),
      .separator(),
      item("關閉視窗", #selector(NSWindow.performClose(_:)), "w"),
    ])
    NSApp.windowsMenu = windowMenu

    let helpMenu = add("輔助說明", [item("\(name)操作說明", #selector(showHelp(_:)), "?", target: self)])
    NSApp.helpMenu = helpMenu
    NSApp.mainMenu = main
  }

  // View ▸ zoom scales the whole interface (HUD + canvas); the in-game camera zoom is separate.
  private func setPageZoom(_ z: Double) {
    let v = min(1.5, max(0.75, (z * 20).rounded() / 20))
    webView.pageZoom = v
    UserDefaults.standard.set(v, forKey: kPageZoomKey)
  }
  @objc private func zoomReset(_ sender: Any?) { setPageZoom(1) }
  @objc private func zoomIn(_ sender: Any?) { setPageZoom(webView.pageZoom + 0.1) }
  @objc private func zoomOut(_ sender: Any?) { setPageZoom(webView.pageZoom - 0.1) }
  @objc private func reloadPage(_ sender: Any?) { webView.load(URLRequest(url: SchemeHandler.indexURL)) }

  /// Self-test only: puts the window in the states a player's window can be in, so a test script can
  /// measure what keeps ticking (`cinderNative` has no such call outside `--selftest`).
  private func testWindow(_ action: String) {
    log("testWindow \(action)")
    switch action {
    case "cover":
      guard coverWindow == nil else { return }
      let w = NSWindow(contentRect: window.frame.insetBy(dx: -40, dy: -40), styleMask: [.borderless], backing: .buffered, defer: false)
      w.isOpaque = true
      w.backgroundColor = .black
      w.level = .floating
      w.isReleasedWhenClosed = false
      w.orderFrontRegardless()
      coverWindow = w
    case "uncover":
      coverWindow?.orderOut(nil)
      coverWindow = nil
    case "miniaturize": window.miniaturize(nil)
    case "deminiaturize": window.deminiaturize(nil)
    case "hide": NSApp.hide(nil)
    case "unhide": NSApp.unhide(nil)
    case "reload": webView.load(URLRequest(url: SchemeHandler.indexURL))
    default: break
    }
  }

  /// The page may handle `cinder:help` (and call preventDefault); otherwise show a native summary.
  @objc private func showHelp(_ sender: Any?) {
    let js = "window.dispatchEvent(new CustomEvent('cinder:help', { cancelable: true }))"
    webView.evaluateJavaScript(js) { [weak self] result, _ in
      guard let self, (result as? Bool) != false else { return }
      let a = NSAlert()
      a.messageText = "燼原戰線 操作說明"
      a.informativeText = """
      左鍵:選取單位、框選、放置建築
      右鍵:移動/攻擊/採集
      雙指滑動或滑鼠移到邊緣:捲動地圖
      雙指開合或滾輪:縮放視角
      ⌃⌘F:切換全螢幕  ⌘Q:結束遊戲
      """
      a.addButton(withTitle: "好")
      a.beginSheetModal(for: self.window, completionHandler: nil)
    }
  }

  // MARK: - Self test (`--selftest [--out file] [--snapshot file.png] [--eval file.js]`)

  private func runSelfTest() {
    guard !selfTestStarted else { return }
    selfTestStarted = true
    let body = """
    const r = {
      title: document.title, href: location.href, lang: document.documentElement.lang,
      appText: (document.getElementById('app') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 160),
      moduleScripts: document.querySelectorAll('script[type=module]').length,
      native: !!(window.cinderNative && window.cinderNative.isNative), nativeVersion: window.cinderNative && window.cinderNative.version,
      dpr: window.devicePixelRatio, inner: [window.innerWidth, window.innerHeight],
      background: getComputedStyle(document.body).backgroundColor, userSelect: getComputedStyle(document.documentElement).webkitUserSelect,
    };
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const c = new AC();
      r.audioInitialState = c.state;
      // no user gesture has happened: this only succeeds because autoplay is allowed for the app
      await Promise.race([c.resume(), new Promise((res) => setTimeout(res, 1500))]);
      const t0 = c.currentTime;
      await new Promise((res) => setTimeout(res, 250));
      r.audioState = c.state; r.audioClockAdvanced = c.currentTime > t0; r.sampleRate = c.sampleRate; c.close();
    } catch (e) { r.audioError = String(e); }
    try {
      let v = speechSynthesis.getVoices();
      if (!v.length) { await new Promise((res) => setTimeout(res, 600)); v = speechSynthesis.getVoices(); }
      r.voices = v.length; r.zhTW = v.filter((x) => /zh[-_]TW/i.test(x.lang)).map((x) => x.name);
    } catch (e) { r.speechError = String(e); }
    try { localStorage.setItem('cinder.selftest', '1'); r.localStorage = localStorage.getItem('cinder.selftest') === '1'; } catch (e) { r.localStorage = false; }
    try { const res = await fetch('./index.html'); r.fetchIndex = res.status + ' ' + res.headers.get('content-type'); } catch (e) { r.fetchIndex = 'failed: ' + e; }
    try { const res = await fetch('./__missing__.js'); r.fetchMissing = res.status; } catch (e) { r.fetchMissing = 'failed: ' + e; }
    try { await fetch('https://example.com/', { mode: 'no-cors' }); r.remoteBlocked = false; } catch (e) { r.remoteBlocked = true; }
    r.contentRules = '__RULES__';
    window.cinderNative && window.cinderNative.log('bridge-ok');
    await new Promise((res) => setTimeout(res, 100));
    /*EVAL*/
    r.errors = window.__cinderErrors || [];
    return JSON.stringify(r);
    """
    // `--eval file.js`: extra async JS (function body) run in the page; its return value lands in `eval`.
    var script = body.replacingOccurrences(of: "__RULES__", with: contentRulesActive ? "active" : "missing")
    if let path = argValue("--eval"), let src = try? String(contentsOfFile: path, encoding: .utf8) {
      script = script.replacingOccurrences(of: "/*EVAL*/", with: "try { r.eval = await (async () => {\n\(src)\n})(); } catch (e) { r.evalError = String((e && e.stack) || e); }")
    }
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let value):
        var json = value as? String ?? "{}"
        let extra = ",\"bridgeMessages\":\(self.bridgeMessages),\"windowTitle\":\"\(self.window.title)\",\"frame\":\"\(NSStringFromRect(self.window.frame))\",\"firstResponderIsWebView\":\(self.window.firstResponder === self.webView || (self.window.firstResponder as? NSView)?.isDescendant(of: self.webView) == true),\"backingScale\":\(self.window.backingScaleFactor),\"appNapOptOut\":\(self.activity != nil),\"netEventsDelivered\":\(self.netEventsDelivered),\"netInstance\":\"\(self.net.instance)\",\"debug\":\(self.debugMode)}"
        if json.hasSuffix("}") { json = String(json.dropLast()) + extra }
        self.snapshotThenFinish(json: json)
      case .failure(let error):
        self.finishSelfTest(json: "{\"error\":\"\(error.localizedDescription)\"}", ok: false)
      }
    }
  }

  private func snapshotThenFinish(json: String) {
    guard let path = argValue("--snapshot") else { return finishSelfTest(json: json, ok: true) }
    webView.takeSnapshot(with: nil) { [weak self] image, _ in
      if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: path))
      }
      self?.finishSelfTest(json: json, ok: true)
    }
  }

  private var selfTestFinished = false
  private func finishSelfTest(json: String, ok: Bool) {
    guard !selfTestFinished else { return }
    selfTestFinished = true
    print("SELFTEST \(json)")
    fflush(stdout)
    if let out = argValue("--out") { try? json.write(toFile: out, atomically: true, encoding: .utf8) }
    exit(ok ? 0 : 1)
  }
}

private extension String {
  func withBrackets() -> String { "[" + self + "]" }
}
