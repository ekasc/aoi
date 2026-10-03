// Appended to FacePhoto.swift by the verification runner; no Expo app is launched.
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let modelURL = URL(fileURLWithPath: CommandLine.arguments[2])
let descriptorData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))
let descriptor = try JSONSerialization.jsonObject(with: descriptorData) as! [String: Any]
let validModel = try FacePhoto.verifyModel(modelURL.absoluteString, bytes: descriptor["bytes"] as! Int, sha256: descriptor["sha256"] as! String)
let wrongModel = try FacePhoto.verifyModel(modelURL.absoluteString, bytes: descriptor["bytes"] as! Int, sha256: String(repeating: "0", count: 64))
precondition(validModel && !wrongModel)
let casesData = try Data(contentsOf: directory.appendingPathComponent("cases.json"))
let cases = try JSONSerialization.jsonObject(with: casesData) as! [[String: Any]]
let photo = try FacePhoto.load(directory.appendingPathComponent("synthetic.png").absoluteString)
let faceBounds = CGRect(x: 0.1, y: 0.1, width: 0.2, height: 0.3)
precondition(FacePhoto.overlapsFace(faceBounds, faceBounds))
precondition(FacePhoto.overlapsFace(faceBounds, CGRect(x: 0.12, y: 0.12, width: 0.18, height: 0.28)))
precondition(!FacePhoto.overlapsFace(faceBounds, CGRect(x: 0.5, y: 0.1, width: 0.2, height: 0.3)))
precondition(!FacePhoto.overlapsFace(faceBounds, CGRect(x: 0.29, y: 0.1, width: 0.2, height: 0.3)))
precondition(!FacePhoto.overlapsFace(faceBounds, CGRect(x: 0.1, y: 0.1, width: 0, height: 0)))
let overshooting = CGRect(x: 0.05, y: -0.1, width: 0.9, height: 0.85)
let clipped = FacePhoto.visibleFaceBounds(overshooting)!
precondition(clipped.minY == 0 && abs(clipped.height - 0.75) < 1e-9)
precondition(abs(clipped.minX - overshooting.minX) < 1e-9 && abs(clipped.width - overshooting.width) < 1e-9)
precondition(overshooting.minY == -0.1, "Clipping must not mutate the observation frame used by landmarks")
precondition(FacePhoto.visibleFaceBounds(CGRect(x: 2, y: 2, width: 1, height: 1)) == nil)
precondition(FacePhoto.visibleFaceBounds(CGRect(x: 0, y: 0, width: 1, height: 1)) == CGRect(x: 0, y: 0, width: 1, height: 1))
precondition(photo.width == 240 && photo.height == 180)
let detection = try photo.detectedFaces()
precondition((detection["faces"] as! [[String: Any]]).isEmpty)
for item in cases {
  let transform = item["transform"] as! [String: Double]
  let pixels = try photo.alignedPixels([transform["a"]!, transform["b"]!, transform["tx"]!, transform["ty"]!])
  precondition(pixels.count == 3 * 112 * 112 && pixels.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 255 })
  let bytes = pixels.withUnsafeBytes { Data($0) }
  try bytes.write(to: directory.appendingPathComponent((item["name"] as! String) + ".bin"))
}

for orientation in 1...8 {
  let file = directory.appendingPathComponent("orientation-\(orientation).tiff")
  let destination = CGImageDestinationCreateWithURL(file as CFURL, "public.tiff" as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, photo.image, [kCGImagePropertyOrientation: orientation] as CFDictionary)
  precondition(CGImageDestinationFinalize(destination))
  let oriented = try FacePhoto.load(file.absoluteString)
  let swapped = orientation >= 5
  precondition(oriented.width == (swapped ? 180 : 240) && oriented.height == (swapped ? 240 : 180))
  let pixels = try oriented.alignedPixels([1, 0, 0, 0])
  for (x, y) in [(0, 0), (10, 20), (20, 10), (100, 100)] {
    let sx: Int, sy: Int
    switch orientation {
    case 1: (sx, sy) = (x, y)
    case 2: (sx, sy) = (239 - x, y)
    case 3: (sx, sy) = (239 - x, 179 - y)
    case 4: (sx, sy) = (x, 179 - y)
    case 5: (sx, sy) = (y, x)
    case 6: (sx, sy) = (y, 179 - x)
    case 7: (sx, sy) = (239 - y, 179 - x)
    default: (sx, sy) = (239 - y, x)
    }
    let expected = [(sx * 3 + sy) % 256, (sy * 2 + sx) % 256, (sx + sy * 3) % 256]
    for channel in 0..<3 {
      precondition(pixels[channel * 112 * 112 + y * 112 + x] == Float(expected[channel]), "EXIF orientation \(orientation) mismatch")
    }
  }
}
print("Native clipped-box bounds, Vision no-face read, all eight EXIF orientations, pixel preparation, and streaming model verification passed.")
