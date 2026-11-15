// Typefall 앱 아이콘 생성: swift make-icon.swift  →  ../macos/AppIcon.icns
import AppKit

func render(_ px: Int) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    let rect = NSRect(x: s * 0.06, y: s * 0.06, width: s * 0.88, height: s * 0.88)   // macOS 아이콘 여백
    let path = NSBezierPath(roundedRect: rect, xRadius: s * 0.2, yRadius: s * 0.2)
    NSGradient(colors: [NSColor(srgbRed: 0.36, green: 0.58, blue: 1.0, alpha: 1), NSColor(srgbRed: 0.10, green: 0.17, blue: 0.45, alpha: 1)])!
        .draw(in: path, angle: -90)
    // 흰색 눈송이
    let cfg = NSImage.SymbolConfiguration(pointSize: s * 0.55, weight: .medium)
    if let sym = NSImage(systemSymbolName: "snowflake", accessibilityDescription: nil)?.withSymbolConfiguration(cfg) {
        let tinted = NSImage(size: sym.size)
        tinted.lockFocus()
        sym.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1)
        NSColor.white.set()
        NSRect(origin: .zero, size: sym.size).fill(using: .sourceAtop)
        tinted.unlockFocus()
        let w = sym.size.width, h = sym.size.height
        tinted.draw(at: NSPoint(x: (s - w) / 2, y: (s - h) / 2), from: .zero, operation: .sourceOver, fraction: 1)
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let dir = FileManager.default.currentDirectoryPath + "/AppIcon.iconset"
try? FileManager.default.removeItem(atPath: dir)
try! FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
let sizes: [(String, Int)] = [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256),
                              ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)]
for (name, px) in sizes {
    let data = render(px).representation(using: .png, properties: [:])!
    try! data.write(to: URL(fileURLWithPath: "\(dir)/icon_\(name).png"))
}
print("iconset ready: \(dir)")
