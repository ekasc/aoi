import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import Vision

struct FacePhoto {
  let image: CGImage
  let width: Double
  let height: Double

  static func failure() -> NSError {
    NSError(domain: "AoiFaceDetector", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not process this local photo"])
  }

  static func localURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL,
      url.host == nil || url.host == "" || url.host == "localhost",
      url.query == nil, url.fragment == nil else { throw failure() }
    return url
  }

  static func load(_ uri: String) throws -> FacePhoto {
    let url = try localURL(uri)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let rawWidth = properties[kCGImagePropertyPixelWidth] as? NSNumber,
      let rawHeight = properties[kCGImagePropertyPixelHeight] as? NSNumber,
      rawWidth.doubleValue.isFinite, rawHeight.doubleValue.isFinite,
      rawWidth.doubleValue > 0, rawHeight.doubleValue > 0 else { throw failure() }
    let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
    guard (1...8).contains(orientation) else { throw failure() }
    let swapped = (5...8).contains(orientation)
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: 2048,
      kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary) else { throw failure() }
    return FacePhoto(image: image, width: swapped ? rawHeight.doubleValue : rawWidth.doubleValue,
                     height: swapped ? rawWidth.doubleValue : rawHeight.doubleValue)
  }

  static func visibleFaceBounds(_ bounds: CGRect) -> CGRect? {
    let visible = bounds.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    return visible.isNull || visible.isEmpty ? nil : visible
  }

  static func overlapsFace(_ a: CGRect, _ b: CGRect) -> Bool {
    let intersection = a.intersection(b)
    guard !intersection.isNull, !intersection.isEmpty else { return false }
    let smallerArea = min(a.width * a.height, b.width * b.height)
    return smallerArea > 0 && intersection.width * intersection.height >= smallerArea * 0.3
  }

  func detectedFaces(assessQuality: Bool = false, useModernFallback: Bool = true) throws -> [String: Any] {
    let request = VNDetectFaceLandmarksRequest()
    do { try VNImageRequestHandler(cgImage: image, orientation: .up).perform([request]) }
    catch { throw Self.failure() }
    var observations = request.results ?? []
    // The landmark request still uses the older detector; revision 3 can recover profile faces.
    // Keep its crowded-photo results, and never let a second pass duplicate one face as two people.
    if useModernFallback && observations.count < 2 && VNDetectFaceRectanglesRequest.supportedRevisions.contains(3) {
      let rectangles = VNDetectFaceRectanglesRequest()
      rectangles.revision = 3
      let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
      do {
        try handler.perform([rectangles])
        let additional = (rectangles.results ?? []).filter { candidate in
          !observations.contains { Self.overlapsFace($0.boundingBox, candidate.boundingBox) }
        }
        if !additional.isEmpty {
          let landmarks = VNDetectFaceLandmarksRequest()
          landmarks.inputFaceObservations = additional
          try handler.perform([landmarks])
          for candidate in landmarks.results ?? [] {
            if !observations.contains(where: { Self.overlapsFace($0.boundingBox, candidate.boundingBox) }) {
              observations.append(candidate)
            }
          }
        }
      } catch { throw Self.failure() }
    }
    let quality = VNDetectFaceCaptureQualityRequest()
    if assessQuality {
      quality.inputFaceObservations = observations
      do { try VNImageRequestHandler(cgImage: image, orientation: .up).perform([quality]) }
      catch { throw Self.failure() }
    }
    let faces: [[String: Any]] = observations.compactMap { observation in
      let bounds = observation.boundingBox
      // Vision boxes can extend beyond a cropped portrait. Landmarks keep their original frame.
      guard let visibleBounds = Self.visibleFaceBounds(bounds) else { return nil }
      let roll: Any
      if let angle = observation.roll { roll = angle.doubleValue * 180 / .pi }
      else { roll = NSNull() }
      let regions: Any
      if let landmarks = observation.landmarks {
        func points(_ region: VNFaceLandmarkRegion2D?) -> [[String: Double]] {
          (region?.normalizedPoints ?? []).map { point in
            ["x": (Double(bounds.minX) + Double(point.x) * Double(bounds.width)) * width,
             "y": (1 - Double(bounds.minY) - Double(point.y) * Double(bounds.height)) * height]
          }
        }
        regions = ["leftEye": points(landmarks.leftEye), "rightEye": points(landmarks.rightEye),
                   "noseCrest": points(landmarks.noseCrest), "outerLips": points(landmarks.outerLips)]
      } else { regions = NSNull() }
      // Vision's normalized origin is bottom-left; callers use top-left oriented pixels.
      let score: Any = assessQuality ? (quality.results?.first(where: { $0.boundingBox == bounds })?.faceCaptureQuality ?? NSNull()) : NSNull()
      return ["x": Double(visibleBounds.minX) * width, "y": (1 - Double(visibleBounds.maxY)) * height,
              "width": Double(visibleBounds.width) * width, "height": Double(visibleBounds.height) * height,
              "rollAngle": roll, "landmarkRegions": regions, "captureQuality": score]
    }
    return ["width": width, "height": height, "faces": faces]
  }

  /** Returns RGB float32 NCHW pixels, matching the reference's scale=1 and mean=0. */
  func alignedPixels(_ transform: [Double]) throws -> [Float] {
    guard transform.count == 4, transform.allSatisfy({ $0.isFinite }) else { throw Self.failure() }
    let a = transform[0], b = transform[1], tx = transform[2], ty = transform[3]
    let determinant = a * a + b * b
    guard determinant >= 1e-12 else { throw Self.failure() }
    let w = image.width, h = image.height
    var rgba = [UInt8](repeating: 0, count: w * h * 4)
    let rendered = rgba.withUnsafeMutableBytes { bytes -> Bool in
      guard let context = CGContext(data: bytes.baseAddress, width: w, height: h, bitsPerComponent: 8,
        bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard rendered else { throw Self.failure() }
    let size = 112, plane = 112 * 112
    var output = [Float](repeating: 0, count: plane * 3)
    func pixel(_ x: Int, _ y: Int, _ channel: Int) -> Double {
      if x < 0 || x >= w || y < 0 || y >= h { return 0 }
      return Double(rgba[(y * w + x) * 4 + channel])
    }
    for y in 0..<size {
      for x in 0..<size {
        let u = Double(x) - tx, v = Double(y) - ty
        let sx = ((a * u + b * v) / determinant) * Double(w) / width
        let sy = ((-b * u + a * v) / determinant) * Double(h) / height
        // OpenCV INTER_LINEAR uses a 1/32-pixel interpolation table.
        let qx = (sx * 32).rounded() / 32, qy = (sy * 32).rounded() / 32
        if !qx.isFinite || !qy.isFinite || qx < -1 || qy < -1 || qx > Double(w) || qy > Double(h) { continue }
        let ix = Int(floor(qx)), iy = Int(floor(qy))
        let fx = qx - Double(ix), fy = qy - Double(iy)
        for channel in 0..<3 {
          let value = pixel(ix, iy, channel) * (1 - fx) * (1 - fy) + pixel(ix + 1, iy, channel) * fx * (1 - fy)
            + pixel(ix, iy + 1, channel) * (1 - fx) * fy + pixel(ix + 1, iy + 1, channel) * fx * fy
          output[channel * plane + y * size + x] = Float(value.rounded())
        }
      }
    }
    return output
  }

  static func verifyModel(_ uri: String, bytes: Int, sha256: String) throws -> Bool {
    do {
      let url = try localURL(uri)
      let file = try FileHandle(forReadingFrom: url)
      defer { try? file.close() }
      var hash = SHA256(), count = 0
      while let chunk = try file.read(upToCount: 1024 * 1024), !chunk.isEmpty {
        count += chunk.count
        if count > bytes { return false }
        hash.update(data: chunk)
      }
      return count == bytes && hash.finalize().map { String(format: "%02x", $0) }.joined() == sha256
    } catch { throw failure() }
  }
}
