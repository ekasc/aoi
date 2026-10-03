// Compiled beside the app's unchanged FacePhoto.swift as a headless Mac executable.
import CoreGraphics
import Foundation
import ImageIO
import Vision

func reply(_ value: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
  print(text)
  fflush(stdout)
}

reply(["ready": true, "os": ProcessInfo.processInfo.operatingSystemVersionString, "visionRevision": VNDetectFaceLandmarksRequest.defaultRevision])
while let line = readLine() {
  autoreleasepool {
    do {
      guard let data = line.data(using: .utf8),
        let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let op = request["op"] as? String,
        let uri = request["uri"] as? String else { throw FacePhoto.failure() }
      if op == "synthetic" {
        var rgba = [UInt8](repeating: 127, count: 240 * 180 * 4)
        for index in stride(from: 3, to: rgba.count, by: 4) { rgba[index] = 255 }
        let image: CGImage? = rgba.withUnsafeMutableBytes { bytes in
          CGContext(data: bytes.baseAddress, width: 240, height: 180, bitsPerComponent: 8, bytesPerRow: 240 * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage()
        }
        guard let image, let destination = CGImageDestinationCreateWithURL(try FacePhoto.localURL(uri) as CFURL, "public.png" as CFString, 1, nil) else { throw FacePhoto.failure() }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw FacePhoto.failure() }
        reply(["ok": true])
      } else {
        let photo = try FacePhoto.load(uri)
        if op == "detect" { reply(["value": try photo.detectedFaces(useModernFallback: request["modernFallback"] as? Bool ?? true)]) }
        else if op == "prepare", let transform = request["transform"] as? [Double] { reply(["value": try photo.alignedPixels(transform)]) }
        else { throw FacePhoto.failure() }
      }
    } catch { reply(["error": "Native photo processing failed"]) }
  }
}
