import AppKit
import Foundation

let target = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build")
try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)

func png(size: Int, tray: Bool = false) -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let s = CGFloat(size)
    if !tray {
        NSColor(calibratedRed: 0.71, green: 0.9, blue: 0.74, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: s * 0.08, y: s * 0.08, width: s * 0.84, height: s * 0.84), xRadius: s * 0.2, yRadius: s * 0.2).fill()
    }
    let color = tray ? NSColor.black : NSColor(calibratedRed: 0.09, green: 0.2, blue: 0.12, alpha: 1)
    let font = NSFont(name: "Georgia-Bold", size: s * 0.67) ?? NSFont.boldSystemFont(ofSize: s * 0.67)
    NSString(string: "p").draw(at: NSPoint(x: s * 0.22, y: s * 0.16), withAttributes: [.font: font, .foregroundColor: color])
    color.setFill()
    NSBezierPath(ovalIn: NSRect(x: s * 0.68, y: s * 0.29, width: s * 0.075, height: s * 0.075)).fill()
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}

try png(size: 1024).write(to: target.appendingPathComponent("icon.png"))
try png(size: 36, tray: true).write(to: target.appendingPathComponent("trayTemplate.png"))
let iconset = target.appendingPathComponent("icon.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    try png(size: size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try png(size: size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
// PNG-in-ICO is supported by modern Windows and electron-builder.
let image = png(size: 256)
var ico = Data([0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 32, 0])
for value in [UInt32(image.count), UInt32(22)] {
    var little = value.littleEndian
    ico.append(Data(bytes: &little, count: 4))
}
ico.append(image)
try ico.write(to: target.appendingPathComponent("icon.ico"))
print("Created PromptTune application and tray icons.")
