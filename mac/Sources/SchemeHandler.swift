import Foundation
import WebKit

/// Serves the bundled web build (Resources/web) at `cinder://app/…` with proper MIME types.
/// ES-module builds do not load reliably from file:// URLs, and this also keeps the page
/// in a single, local-only origin.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
  static let scheme = "cinder"
  static let host = "app"
  static var indexURL: URL { URL(string: "\(scheme)://\(host)/index.html")! }

  private let root: URL
  private var stopped = Set<ObjectIdentifier>()

  init(root: URL) {
    self.root = root.standardizedFileURL
  }

  private static let mime: [String: String] = [
    "html": "text/html; charset=utf-8",
    "htm": "text/html; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
    "mjs": "text/javascript; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "json": "application/json; charset=utf-8",
    "map": "application/json; charset=utf-8",
    "webmanifest": "application/manifest+json; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "ico": "image/x-icon",
    "wasm": "application/wasm",
    "woff": "font/woff",
    "woff2": "font/woff2",
    "ttf": "font/ttf",
    "otf": "font/otf",
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
  ]

  /// Maps a request URL to a file inside the web root, refusing anything that escapes it.
  func fileURL(for url: URL) -> URL? {
    guard url.scheme == Self.scheme, url.host == Self.host else { return nil }
    var path = url.path.removingPercentEncoding ?? url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    let candidate = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
    let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
    guard candidate.path.hasPrefix(rootPath) else { return nil }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir) else { return nil }
    return isDir.boolValue ? candidate.appendingPathComponent("index.html") : candidate
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    guard let file = fileURL(for: url), let data = try? Data(contentsOf: file) else {
      respond(task, url: url, status: 404, type: "text/plain; charset=utf-8", data: Data("Not found".utf8))
      return
    }
    let type = Self.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
    respond(task, url: url, status: 200, type: type, data: data)
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
    stopped.insert(ObjectIdentifier(task))
  }

  private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, type: String, data: Data) {
    let id = ObjectIdentifier(task)
    if stopped.remove(id) != nil { return }
    let headers = [
      "Content-Type": type,
      "Content-Length": String(data.count),
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    ]
    guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
      task.didFailWithError(URLError(.cannotParseResponse))
      return
    }
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
  }
}
