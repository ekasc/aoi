import Foundation
import Vision

func reply(_ value: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: value),
    let text = String(data: data, encoding: .utf8) else { return }
  print(text)
  fflush(stdout)
}

reply(["rectanglesDefault": VNDetectFaceRectanglesRequest.defaultRevision,
       "landmarksDefault": VNDetectFaceLandmarksRequest.defaultRevision,
       "os": ProcessInfo.processInfo.operatingSystemVersionString])
while let line = readLine() {
  autoreleasepool {
    do {
      let photo = try FacePhoto.load(line)
      for mode in ["landmarks-default", "rectangles-2", "rectangles-3", "rectangles-3-landmarks", "landmarks-76"] {
        let start = ProcessInfo.processInfo.systemUptime
        let handler = VNImageRequestHandler(cgImage: photo.image, orientation: .up)
        let landmarks = VNDetectFaceLandmarksRequest()
        var faces: [VNFaceObservation]
        if mode.hasPrefix("rectangles") {
          let boxes = VNDetectFaceRectanglesRequest()
          boxes.revision = mode == "rectangles-2" ? 2 : 3
          try handler.perform([boxes])
          if mode == "rectangles-3-landmarks" {
            landmarks.inputFaceObservations = boxes.results ?? []
            try handler.perform([landmarks])
            faces = landmarks.results ?? []
          } else { faces = boxes.results ?? [] }
        } else {
          if mode == "landmarks-76" { landmarks.constellation = .constellation76Points }
          try handler.perform([landmarks])
          faces = landmarks.results ?? []
        }
        reply(["mode": mode, "milliseconds": (ProcessInfo.processInfo.systemUptime - start) * 1000,
          "faces": faces.map { face -> [String: Any] in
            ["bounds": [face.boundingBox.minX, face.boundingBox.minY, face.boundingBox.width, face.boundingBox.height],
             "yaw": face.yaw ?? NSNull(), "pitch": face.pitch ?? NSNull(),
             "leftEyePoints": face.landmarks?.leftEye?.pointCount ?? 0,
             "rightEyePoints": face.landmarks?.rightEye?.pointCount ?? 0,
             "mouthPoints": face.landmarks?.outerLips?.pointCount ?? 0]
          }])
      }
    } catch { reply(["error": "Apple Vision probe failed"]) }
  }
}
