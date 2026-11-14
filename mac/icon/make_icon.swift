// Draws the Cinder Front app icon procedurally (CoreGraphics) and writes a .iconset folder.
// Original emblem: an isometric slab split by a jagged front line — cool Helion blue on one side,
// Ferrum ember on the other — with a glowing cinder shard rising above it.
// Usage: make_icon <out.iconset>
import CoreGraphics
import Foundation
import ImageIO

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

let space = CGColorSpace(name: CGColorSpace.sRGB)!

func poly(_ ctx: CGContext, _ pts: [(CGFloat, CGFloat)]) {
  ctx.beginPath()
  ctx.move(to: CGPoint(x: pts[0].0, y: pts[0].1))
  for p in pts.dropFirst() { ctx.addLine(to: CGPoint(x: p.0, y: p.1)) }
  ctx.closePath()
}

func gradient(_ ctx: CGContext, _ colors: [CGColor], from: CGPoint, to: CGPoint) {
  let g = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: nil)!
  ctx.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}

/// Draws the icon into a 1024-unit design space (origin top-left, y down).
func draw(_ ctx: CGContext) {
  let card = CGRect(x: 100, y: 100, width: 824, height: 824)
  let cardPath = CGPath(roundedRect: card, cornerWidth: 186, cornerHeight: 186, transform: nil)

  // soft drop shadow under the card
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 28, color: rgb(0x000000, 0.45))
  ctx.addPath(cardPath)
  ctx.setFillColor(rgb(0x0b0d10))
  ctx.fillPath()
  ctx.restoreGState()

  ctx.saveGState()
  ctx.addPath(cardPath)
  ctx.clip()
  gradient(ctx, [rgb(0x27303a), rgb(0x12161b), rgb(0x0b0d10)], from: CGPoint(x: 512, y: 100), to: CGPoint(x: 512, y: 924))

  // faint isometric grid
  ctx.setStrokeColor(rgb(0xffffff, 0.035))
  ctx.setLineWidth(3)
  var k: CGFloat = -900
  while k < 1900 {
    ctx.move(to: CGPoint(x: k, y: 100)); ctx.addLine(to: CGPoint(x: k + 1648, y: 924))
    ctx.move(to: CGPoint(x: k, y: 100)); ctx.addLine(to: CGPoint(x: k - 1648, y: 924))
    k += 120
  }
  ctx.strokePath()

  // glow behind the shard
  let glow = CGGradient(colorsSpace: space, colors: [rgb(0xff8a2a, 0.55), rgb(0xff8a2a, 0)] as CFArray, locations: nil)!
  ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 330), startRadius: 0, endCenter: CGPoint(x: 512, y: 330), endRadius: 330, options: [])

  // ── slab ──
  let T: (CGFloat, CGFloat) = (512, 452), R: (CGFloat, CGFloat) = (806, 599), B: (CGFloat, CGFloat) = (512, 746), L: (CGFloat, CGFloat) = (218, 599)
  let h: CGFloat = 62
  // side faces
  ctx.saveGState()
  poly(ctx, [L, B, (B.0, B.1 + h), (L.0, L.1 + h)]); ctx.clip()
  gradient(ctx, [rgb(0x145a66), rgb(0x0b2a33)], from: CGPoint(x: L.0, y: L.1), to: CGPoint(x: B.0, y: B.1 + h))
  ctx.restoreGState()
  ctx.saveGState()
  poly(ctx, [B, R, (R.0, R.1 + h), (B.0, B.1 + h)]); ctx.clip()
  gradient(ctx, [rgb(0x471a12), rgb(0x8a3418)], from: CGPoint(x: B.0, y: B.1 + h), to: CGPoint(x: R.0, y: R.1))
  ctx.restoreGState()

  // top face, split by the front line
  let zig: [(CGFloat, CGFloat)] = [T, (466, 512), (552, 566), (474, 628), (544, 684), B]
  ctx.saveGState()
  poly(ctx, [L] + zig); ctx.clip()
  gradient(ctx, [rgb(0x46e6d2), rgb(0x2b7fd6)], from: CGPoint(x: 512, y: 452), to: CGPoint(x: 218, y: 660))
  ctx.restoreGState()
  ctx.saveGState()
  poly(ctx, [R] + zig.reversed()); ctx.clip()
  gradient(ctx, [rgb(0xffbe4a), rgb(0xe5484d)], from: CGPoint(x: 512, y: 452), to: CGPoint(x: 806, y: 660))
  ctx.restoreGState()

  // top-face highlight edges
  ctx.setStrokeColor(rgb(0xffffff, 0.35)); ctx.setLineWidth(5); ctx.setLineJoin(.round)
  ctx.beginPath(); ctx.move(to: CGPoint(x: L.0, y: L.1)); ctx.addLine(to: CGPoint(x: T.0, y: T.1)); ctx.addLine(to: CGPoint(x: R.0, y: R.1)); ctx.strokePath()

  // the front line: dark trench with a glowing core
  func strokeZig(_ width: CGFloat, _ color: CGColor) {
    ctx.beginPath()
    ctx.move(to: CGPoint(x: zig[0].0, y: zig[0].1))
    for p in zig.dropFirst() { ctx.addLine(to: CGPoint(x: p.0, y: p.1)) }
    ctx.setLineWidth(width); ctx.setStrokeColor(color); ctx.setLineJoin(.miter); ctx.setLineCap(.butt)
    ctx.strokePath()
  }
  ctx.saveGState()
  poly(ctx, [T, R, B, L]); ctx.clip()
  strokeZig(30, rgb(0x0b0d10))
  ctx.setShadow(offset: .zero, blur: 22, color: rgb(0xffa040, 0.95))
  strokeZig(7, rgb(0xfff3d6))
  ctx.restoreGState()

  // ── cinder shard ──
  let st: (CGFloat, CGFloat) = (512, 168), sr: (CGFloat, CGFloat) = (586, 318), sb: (CGFloat, CGFloat) = (512, 414), sl: (CGFloat, CGFloat) = (446, 306)
  ctx.saveGState()
  ctx.setShadow(offset: .zero, blur: 60, color: rgb(0xff7a1a, 0.95))
  poly(ctx, [st, sr, sb, sl]); ctx.setFillColor(rgb(0xff8a2a)); ctx.fillPath()
  ctx.restoreGState()
  ctx.saveGState()
  poly(ctx, [st, sr, sb, sl]); ctx.clip()
  gradient(ctx, [rgb(0xfff6c8), rgb(0xffb03a), rgb(0xe5484d)], from: CGPoint(x: 512, y: 168), to: CGPoint(x: 512, y: 414))
  poly(ctx, [st, sr, (512, 300)]); ctx.setFillColor(rgb(0xffffff, 0.28)); ctx.fillPath()
  poly(ctx, [sl, (512, 300), sb]); ctx.setFillColor(rgb(0x7a1d10, 0.28)); ctx.fillPath()
  ctx.restoreGState()

  // sparks
  let sparks: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [(392, 262, 15, 0.9), (640, 236, 11, 0.85), (604, 156, 8, 0.7), (424, 170, 7, 0.6), (352, 350, 7, 0.5), (676, 330, 6, 0.5)]
  for (x, y, s, a) in sparks {
    ctx.saveGState()
    ctx.setShadow(offset: .zero, blur: s * 1.6, color: rgb(0xff8a2a, 0.9))
    poly(ctx, [(x, y - s), (x + s * 0.7, y), (x, y + s), (x - s * 0.7, y)])
    ctx.setFillColor(rgb(0xffd89a, a)); ctx.fillPath()
    ctx.restoreGState()
  }
  ctx.restoreGState()

  // card rim
  ctx.addPath(CGPath(roundedRect: card.insetBy(dx: 2, dy: 2), cornerWidth: 184, cornerHeight: 184, transform: nil))
  ctx.setStrokeColor(rgb(0xffffff, 0.10)); ctx.setLineWidth(4); ctx.strokePath()
}

func render(size: Int, to url: URL) {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  // design space: 1024 units, y down
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: CGFloat(size) / 1024, y: -CGFloat(size) / 1024)
  draw(ctx)
  let image = ctx.makeImage()!
  let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  if !CGImageDestinationFinalize(dest) { fatalError("cannot write \(url.path)") }
}

guard CommandLine.arguments.count >= 2 else {
  FileHandle.standardError.write(Data("usage: make_icon <out.iconset>\n".utf8))
  exit(2)
}
let out = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
for (name, size) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
  render(size: size, to: out.appendingPathComponent("icon_\(name).png"))
}
print("icon set written to \(out.path)")
