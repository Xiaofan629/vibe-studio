import AppKit
import Foundation

func alphaBoundingBox(of image: CGImage) -> CGRect? {
    guard
        let dataProvider = image.dataProvider,
        let data = dataProvider.data,
        let bytes = CFDataGetBytePtr(data)
    else {
        return nil
    }

    let width = image.width
    let height = image.height
    let bitsPerPixel = image.bitsPerPixel
    let bytesPerRow = image.bytesPerRow
    let alphaInfo = image.alphaInfo

    if bitsPerPixel < 32 {
        return nil
    }

    func alphaOffset(for alphaInfo: CGImageAlphaInfo) -> Int? {
        switch alphaInfo {
        case .premultipliedLast, .last, .noneSkipLast:
            return 3
        case .premultipliedFirst, .first, .noneSkipFirst:
            return 0
        default:
            return nil
        }
    }

    guard let offset = alphaOffset(for: alphaInfo) else {
        return nil
    }

    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1

    for y in 0..<height {
        for x in 0..<width {
            let pixelOffset = y * bytesPerRow + x * (bitsPerPixel / 8) + offset
            let alpha = bytes[pixelOffset]
            if alpha > 0 {
                minX = min(minX, x)
                minY = min(minY, y)
                maxX = max(maxX, x)
                maxY = max(maxY, y)
            }
        }
    }

    if maxX < minX || maxY < minY {
        return nil
    }

    return CGRect(
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    )
}

func renderIcon(sourceURL: URL, destinationURL: URL, canvasSize: CGFloat) throws {
    guard
        let sourceImage = NSImage(contentsOf: sourceURL),
        let tiffData = sourceImage.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiffData),
        let cgImage = bitmap.cgImage
    else {
        throw NSError(domain: "icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to load source image"])
    }

    let contentBox = alphaBoundingBox(of: cgImage) ?? CGRect(
        x: 0,
        y: 0,
        width: cgImage.width,
        height: cgImage.height
    )

    guard let cropped = cgImage.cropping(to: contentBox) else {
        throw NSError(domain: "icon", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to crop source image"])
    }

    let output = NSImage(size: NSSize(width: canvasSize, height: canvasSize))
    output.lockFocus()

    let canvasRect = CGRect(x: 0, y: 0, width: canvasSize, height: canvasSize)
    NSColor.black.setFill()
    canvasRect.fill()

    let mascotTarget = CGRect(
        x: canvasSize * 0.04,
        y: canvasSize * 0.04,
        width: canvasSize * 0.92,
        height: canvasSize * 0.92
    )

    let croppedImage = NSImage(cgImage: cropped, size: .zero)
    let scale = min(
        mascotTarget.width / CGFloat(cropped.width),
        mascotTarget.height / CGFloat(cropped.height)
    )
    let drawSize = CGSize(
        width: CGFloat(cropped.width) * scale,
        height: CGFloat(cropped.height) * scale
    )
    let drawRect = CGRect(
        x: mascotTarget.midX - drawSize.width / 2,
        y: mascotTarget.midY - drawSize.height / 2,
        width: drawSize.width,
        height: drawSize.height
    )

    croppedImage.draw(in: drawRect)

    output.unlockFocus()

    guard
        let outTiff = output.tiffRepresentation,
        let outBitmap = NSBitmapImageRep(data: outTiff),
        let png = outBitmap.representation(using: .png, properties: [:])
    else {
        throw NSError(domain: "icon", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to encode output image"])
    }

    try png.write(to: destinationURL)
}

let args = CommandLine.arguments
guard args.count == 3 else {
    fputs("Usage: regenerate_icons.swift <source> <destination>\n", stderr)
    exit(1)
}

let sourceURL = URL(fileURLWithPath: args[1])
let destinationURL = URL(fileURLWithPath: args[2])

do {
    try renderIcon(sourceURL: sourceURL, destinationURL: destinationURL, canvasSize: 2048)
} catch {
    fputs("Failed to render icon: \(error)\n", stderr)
    exit(1)
}
