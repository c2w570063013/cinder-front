// 燼原戰線 Cinder Front — macOS host application.
// A small AppKit shell that shows the bundled web build in a WKWebView.
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
