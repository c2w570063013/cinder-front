import Foundation
import Network

/// LAN transport behind `window.cinderNative.net` (contract: `NativeNetBridge` / `NativeNetEvent` in src/core/api.ts).
///
/// - Hosting: `NWListener` on an OS-chosen TCP port, advertised over Bonjour as `_cinderfront._tcp`.
///   The Bonjour instance name is a per-process token (it doubles as the stable host id); the room name and
///   the free-form info travel in the TXT record (`name`, `info`, `info1`…).
/// - Browsing: `NWBrowser` for the same type; our own advertisement is filtered out.
/// - Connections: `NWConnection` (TCP, no-delay, keepalive), frames = 4-byte big-endian length + UTF-8 text.
///
/// Everything runs on the main queue, so events are produced — and reach the page — in order.
final class NetBridge {
  static let serviceType = "_cinderfront._tcp"
  /// Largest accepted / sent payload in bytes.
  static let maxFrame = 1 << 20
  private static let txtChunk = 200
  private static let maxPeers = 32
  private static let connectTimeout: TimeInterval = 8

  /// Called (on the main queue) with one `NativeNetEvent` as a JSON-compatible dictionary.
  var emit: ([String: Any]) -> Void = { _ in }
  /// Called whenever `isActive` / `hasConnections` may have changed.
  var onActivityChange: () -> Void = {}
  var log: (String) -> Void = { _ in }

  /// Bonjour instance name of this process = the id other machines see for a room hosted here.
  let instance: String = {
    var bytes = [UInt8](repeating: 0, count: 5)
    for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
    return "CinderFront-" + bytes.map { String(format: "%02x", $0) }.joined()
  }()

  private final class Peer {
    let id: Int
    let connection: NWConnection
    let incoming: Bool
    let hostId: String?
    var opened = false
    var finished = false
    var buffer = Data()
    var lastError: String?
    var timeout: DispatchWorkItem?
    init(id: Int, connection: NWConnection, incoming: Bool, hostId: String?) {
      self.id = id; self.connection = connection; self.incoming = incoming; self.hostId = hostId
    }
  }

  private var listener: NWListener?
  private var listenerAnnounced = false
  private var hostName = ""
  private var hostInfo = ""
  private var browser: NWBrowser?
  /// Hosts we can connect to (kept after stopBrowse so a late connect() still works).
  private var known: [String: NWEndpoint] = [:]
  /// What the page was last told about each host: id → (name, info).
  private var announced: [String: [String]] = [:]
  private var peers: [Int: Peer] = [:]
  private var nextConn = 1
  private var lastErrorText = ""
  private var lastErrorAt = Date.distantPast

  var isHosting: Bool { listener != nil }
  var isBrowsing: Bool { browser != nil }
  var openConnections: Int { peers.values.filter { $0.opened }.count }
  /// True while anything that must keep running in the background exists (a room or a connection).
  var isActive: Bool { listener != nil || !peers.isEmpty }

  // MARK: - Page → native

  func handle(_ body: [String: Any]) {
    guard let op = body["op"] as? String else { return }
    switch op {
    case "host": host(name: body["name"] as? String ?? "", info: body["info"] as? String ?? "")
    case "updateInfo": updateInfo(body["info"] as? String ?? "")
    case "stopHost": stopHost()
    case "browse": browse()
    case "stopBrowse": stopBrowse()
    case "connect": connect(hostId: body["hostId"] as? String ?? "")
    case "send": send(conn: (body["conn"] as? NSNumber)?.intValue ?? -1, text: body["text"] as? String ?? "")
    case "close": close(conn: (body["conn"] as? NSNumber)?.intValue ?? -1)
    case "reset": reset()
    default: break
    }
  }

  // MARK: - Hosting

  func host(name: String, info: String) {
    stopHost()
    hostName = Self.clip(name, bytes: Self.txtChunk)
    hostInfo = info
    let l: NWListener
    do {
      l = try NWListener(using: Self.tcpParameters())
    } catch {
      emit(["type": "hostFailed", "message": "無法建立連線埠:\(error.localizedDescription)"])
      return
    }
    l.service = makeService()
    l.stateUpdateHandler = { [weak self, weak l] state in
      guard let self, let l, self.listener === l else { return }
      switch state {
      case .ready:
        guard !self.listenerAnnounced else { return }
        self.listenerAnnounced = true
        self.emit(["type": "hosting", "port": Int(l.port?.rawValue ?? 0)])
      case .waiting(let error):
        self.log("net: listener waiting: \(error)")
        if Self.isPolicyDenied(error) { self.emitError(Self.permissionMessage) }
      case .failed(let error):
        self.log("net: listener failed: \(error)")
        self.listener = nil
        l.cancel()
        self.emit(["type": "hostFailed", "message": Self.isPolicyDenied(error) || Self.isNoAuth(error) ? Self.permissionMessage : "無法建立房間:\(Self.describe(error))"])
        self.onActivityChange()
      default:
        break
      }
    }
    l.newConnectionHandler = { [weak self, weak l] connection in
      guard let self, let l, self.listener === l, self.peers.count < Self.maxPeers else { return connection.cancel() }
      self.start(Peer(id: self.takeConnId(), connection: connection, incoming: true, hostId: nil))
    }
    listener = l
    listenerAnnounced = false
    l.start(queue: .main)
    onActivityChange()
  }

  func updateInfo(_ info: String) {
    guard let l = listener else { return }
    hostInfo = info
    l.service = makeService() // re-publishes the TXT record; the listener and its port stay as they are
  }

  func stopHost() {
    guard let l = listener else { return }
    listener = nil
    l.stateUpdateHandler = nil
    l.newConnectionHandler = nil
    l.cancel()
    onActivityChange()
  }

  private func makeService() -> NWListener.Service {
    var txt = NWTXTRecord()
    txt["name"] = hostName
    // One TXT entry holds 255 bytes including the key, so longer info is spread over info, info1, info2…
    for (i, chunk) in Self.chunks(hostInfo, bytes: Self.txtChunk).prefix(5).enumerated() {
      txt[i == 0 ? "info" : "info\(i)"] = chunk
    }
    return NWListener.Service(name: instance, type: Self.serviceType, domain: nil, txtRecord: txt)
  }

  // MARK: - Browsing

  func browse() {
    stopBrowse()
    known.removeAll()
    let params = NWParameters()
    params.includePeerToPeer = false
    let b = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: nil), using: params)
    b.stateUpdateHandler = { [weak self, weak b] state in
      guard let self, let b, self.browser === b else { return }
      switch state {
      case .waiting(let error):
        self.log("net: browser waiting: \(error)")
        if Self.isPolicyDenied(error) { self.emitError(Self.permissionMessage) }
      case .failed(let error):
        self.log("net: browser failed: \(error)")
        self.browser = nil
        b.cancel()
        self.emitError(Self.isPolicyDenied(error) || Self.isNoAuth(error) ? Self.permissionMessage : "搜尋區域網路房間失敗:\(Self.describe(error))")
      default:
        break
      }
    }
    b.browseResultsChangedHandler = { [weak self, weak b] results, _ in
      guard let self, let b, self.browser === b else { return }
      self.apply(results)
    }
    browser = b
    b.start(queue: .main)
  }

  func stopBrowse() {
    guard let b = browser else { return }
    browser = nil
    b.stateUpdateHandler = nil
    b.browseResultsChangedHandler = nil
    b.cancel()
    announced.removeAll() // a later browse() reports everything again; `known` stays for connect()
  }

  private func apply(_ results: Set<NWBrowser.Result>) {
    var seen = Set<String>()
    for result in results {
      guard case let .service(name, _, _, _) = result.endpoint, name != instance else { continue }
      var roomName = name
      var info = ""
      if case let .bonjour(txt) = result.metadata {
        roomName = txt["name"] ?? name
        info = txt["info"] ?? ""
        var i = 1
        while let more = txt["info\(i)"] { info += more; i += 1 }
      }
      seen.insert(name)
      known[name] = result.endpoint
      if announced[name] != [roomName, info] {
        announced[name] = [roomName, info]
        emit(["type": "found", "id": name, "name": roomName, "info": info])
      }
    }
    for id in announced.keys where !seen.contains(id) {
      announced[id] = nil
      known[id] = nil
      emit(["type": "lost", "id": id])
    }
  }

  // MARK: - Connections

  func connect(hostId: String) {
    guard let endpoint = known[hostId] else {
      emit(["type": "closed", "conn": -1, "hostId": hostId, "reason": "unknown host"])
      return
    }
    start(Peer(id: takeConnId(), connection: NWConnection(to: endpoint, using: Self.tcpParameters()), incoming: false, hostId: hostId))
  }

  private func takeConnId() -> Int {
    defer { nextConn += 1 }
    return nextConn
  }

  private func start(_ peer: Peer) {
    peers[peer.id] = peer
    peer.connection.stateUpdateHandler = { [weak self, weak peer] state in
      guard let self, let peer, !peer.finished else { return }
      switch state {
      case .ready:
        guard !peer.opened else { return }
        peer.opened = true
        peer.timeout?.cancel()
        var event: [String: Any] = ["type": "open", "conn": peer.id, "incoming": peer.incoming]
        if let hostId = peer.hostId { event["hostId"] = hostId }
        self.emit(event)
        self.receive(peer)
        self.onActivityChange()
      case .waiting(let error):
        peer.lastError = Self.describe(error)
        self.log("net: conn \(peer.id) waiting: \(error)")
        if peer.connection.currentPath?.unsatisfiedReason == .localNetworkDenied || Self.isPolicyDenied(error) {
          self.emitError(Self.permissionMessage)
          self.finish(peer, reason: "denied")
        } else if peer.opened || peer.lastError == "refused" {
          self.finish(peer, reason: peer.lastError ?? "error")
        } // otherwise keep trying until the connect timeout
      case .failed(let error):
        self.finish(peer, reason: Self.describe(error))
      case .cancelled:
        self.finish(peer, reason: "cancelled")
      default:
        break
      }
    }
    let timeout = DispatchWorkItem { [weak self, weak peer] in
      guard let self, let peer, !peer.opened else { return }
      self.finish(peer, reason: peer.lastError.map { "timeout (\($0))" } ?? "timeout")
    }
    peer.timeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.connectTimeout, execute: timeout)
    peer.connection.start(queue: .main)
    onActivityChange()
  }

  private func receive(_ peer: Peer) {
    peer.connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self, weak peer] data, _, isComplete, error in
      guard let self, let peer, !peer.finished else { return }
      if let data, !data.isEmpty {
        peer.buffer.append(data)
        guard self.drain(peer) else { return }
      }
      if let error { return self.finish(peer, reason: Self.describe(error)) }
      if isComplete { return self.finish(peer, reason: "remote") }
      self.receive(peer)
    }
  }

  /// Emits every complete frame in the buffer. False when the connection was dropped for a protocol error.
  private func drain(_ peer: Peer) -> Bool {
    let buf = peer.buffer
    var offset = buf.startIndex
    while buf.endIndex - offset >= 4 {
      let length = Int(buf[offset]) << 24 | Int(buf[offset + 1]) << 16 | Int(buf[offset + 2]) << 8 | Int(buf[offset + 3])
      if length > Self.maxFrame {
        finish(peer, reason: "protocol: frame too large")
        return false
      }
      guard buf.endIndex - offset - 4 >= length else { break }
      let text = String(decoding: buf[(offset + 4)..<(offset + 4 + length)], as: UTF8.self)
      emit(["type": "message", "conn": peer.id, "text": text])
      offset += 4 + length
    }
    if offset > buf.startIndex { peer.buffer = Data(buf[offset...]) }
    return true
  }

  func send(conn: Int, text: String) {
    guard let peer = peers[conn], peer.opened, !peer.finished else { return } // already gone: its 'closed' says so
    let payload = Data(text.utf8)
    guard payload.count <= Self.maxFrame else {
      emitError("訊息過大(\(payload.count) 位元組),未送出。")
      return
    }
    var frame = Data(capacity: payload.count + 4)
    let n = UInt32(payload.count)
    frame.append(contentsOf: [UInt8(n >> 24 & 0xff), UInt8(n >> 16 & 0xff), UInt8(n >> 8 & 0xff), UInt8(n & 0xff)])
    frame.append(payload)
    peer.connection.send(content: frame, completion: .contentProcessed { [weak self, weak peer] error in
      guard let self, let peer, let error else { return }
      self.finish(peer, reason: Self.describe(error))
    })
  }

  func close(conn: Int) {
    guard let peer = peers[conn] else { return }
    finish(peer, reason: "local", graceful: true)
  }

  /// Reports the end of a connection (exactly once) and tears it down.
  /// `graceful`: let already queued sends go out, then send FIN (used for a local close()).
  private func finish(_ peer: Peer, reason: String, graceful: Bool = false, silent: Bool = false) {
    guard !peer.finished else { return }
    peer.finished = true
    peer.timeout?.cancel()
    peers[peer.id] = nil
    let connection = peer.connection
    connection.stateUpdateHandler = nil
    if graceful, peer.opened {
      connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in connection.cancel() })
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { connection.cancel() }
    } else {
      connection.cancel()
    }
    if !silent {
      if peer.opened {
        var event: [String: Any] = ["type": "closed", "conn": peer.id, "reason": reason]
        if let hostId = peer.hostId { event["hostId"] = hostId }
        emit(event)
      } else if !peer.incoming {
        emit(["type": "closed", "conn": -1, "hostId": peer.hostId ?? "", "reason": reason])
      }
    }
    onActivityChange()
  }

  /// Close everything. `silent` (page reload / navigation): no events, the old page is gone.
  func reset(silent: Bool = false) {
    stopHost()
    stopBrowse()
    known.removeAll()
    for peer in peers.values.sorted(by: { $0.id < $1.id }) {
      finish(peer, reason: "local", graceful: true, silent: silent)
    }
    onActivityChange()
  }

  // MARK: - Helpers

  private func emitError(_ message: String) {
    // The same failure tends to be reported by several objects at once; say it once.
    if message == lastErrorText, Date().timeIntervalSince(lastErrorAt) < 3 { return }
    lastErrorText = message
    lastErrorAt = Date()
    emit(["type": "error", "message": message])
  }

  static let permissionMessage = "無法使用區域網路。請到「系統設定 ▸ 隱私權與安全性 ▸ 區域網路」允許「燼原戰線」,然後再試一次。"

  private static func tcpParameters() -> NWParameters {
    let tcp = NWProtocolTCP.Options()
    tcp.noDelay = true
    tcp.enableKeepalive = true
    tcp.keepaliveIdle = 2 // an idle link is probed after 2 s …
    tcp.keepaliveInterval = 1
    tcp.keepaliveCount = 3 // … and dropped after 3 unanswered probes (≈ 5 s)
    tcp.connectionTimeout = 6
    tcp.connectionDropTime = 6 // unacknowledged data: give up after 6 s instead of minutes
    let params = NWParameters(tls: nil, tcp: tcp)
    params.includePeerToPeer = false
    params.allowLocalEndpointReuse = true
    return params
  }

  private static func isPolicyDenied(_ error: NWError) -> Bool {
    if case let .dns(code) = error { return code == -65570 } // kDNSServiceErr_PolicyDenied
    return false
  }

  private static func isNoAuth(_ error: NWError) -> Bool {
    if case let .dns(code) = error { return code == -65555 } // kDNSServiceErr_NoAuth
    return false
  }

  /// Short machine-readable reason for 'closed'.
  private static func describe(_ error: NWError) -> String {
    switch error {
    case .posix(let code):
      switch code {
      case .ECONNREFUSED: return "refused"
      case .ETIMEDOUT: return "timeout"
      case .ECONNRESET, .EPIPE, .ENOTCONN, .ECONNABORTED: return "reset"
      case .ENETDOWN, .ENETUNREACH, .EHOSTUNREACH, .EHOSTDOWN: return "unreachable"
      case .ECANCELED: return "cancelled"
      default: return "error: posix \(code.rawValue)"
      }
    case .dns(let code):
      return "error: dns \(code)"
    case .tls(let code):
      return "error: tls \(code)"
    default:
      return "error: \(error)"
    }
  }

  /// Longest prefix of `s` that fits in `bytes` UTF-8 bytes without cutting a character.
  private static func clip(_ s: String, bytes: Int) -> String {
    chunks(s, bytes: bytes).first ?? ""
  }

  private static func chunks(_ s: String, bytes: Int) -> [String] {
    var out: [String] = []
    var current = ""
    var size = 0
    for ch in s {
      let n = String(ch).utf8.count
      if size + n > bytes, !current.isEmpty {
        out.append(current)
        current = ""
        size = 0
      }
      current.append(ch)
      size += n
    }
    if !current.isEmpty { out.append(current) }
    return out
  }
}
