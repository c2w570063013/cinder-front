import AppKit
import WebKit

/// The window swallows key events nobody handled, so unhandled game keys never trigger the system beep.
final class GameWindow: NSWindow {
  override func keyDown(with event: NSEvent) {
    // Intentionally empty: WKWebView forwards keys the page did not consume up the responder chain,
    // where NSWindow's default implementation would call NSBeep().
  }

  override func noResponder(for eventSelector: Selector) {
    // No beep for unhandled key equivalents either.
  }
}

/// WKWebView tuned for a game: no context menu, and the game (not WebKit) owns pinch / swipe gestures.
final class GameWebView: WKWebView {
  var allowInspectMenu = false

  override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
    if allowInspectMenu {
      // Debug builds keep only "Inspect Element".
      for item in menu.items where item.identifier?.rawValue != "WKMenuItemIdentifierInspectElement" {
        menu.removeItem(item)
      }
    } else {
      menu.removeAllItems()
    }
  }

  override var acceptsFirstResponder: Bool { true }

  // Smart-zoom (two-finger double tap) would otherwise try to magnify the page.
  override func smartMagnify(with event: NSEvent) {}

  // Clicking the window while it is inactive should already count as a click in the game.
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
