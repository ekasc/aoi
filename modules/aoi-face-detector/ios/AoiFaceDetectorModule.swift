import ExpoModulesCore
import Foundation

public class AoiFaceDetectorModule: Module {
  private let detectionQueue = DispatchQueue(label: "aoi.face-detection", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("AoiFaceDetector")

    Function("scanPauseReason") { () -> String? in
      let state = ProcessInfo.processInfo.thermalState
      if state == .serious || state == .critical { return "heat" }
      if ProcessInfo.processInfo.isLowPowerModeEnabled { return "low-power" }
      return nil
    }

    AsyncFunction("detect") { (uri: String) -> [String: Any] in
      try autoreleasepool {
        try FacePhoto.load(uri).detectedFaces()
      }
    }.runOnQueue(detectionQueue)

    AsyncFunction("assessReference") { (uri: String) -> [String: Any] in
      try autoreleasepool { try FacePhoto.load(uri).detectedFaces(assessQuality: true) }
    }.runOnQueue(detectionQueue)

    AsyncFunction("prepareFace") { (uri: String, transform: [Double]) -> [Float] in
      try autoreleasepool { try FacePhoto.load(uri).alignedPixels(transform) }
    }.runOnQueue(detectionQueue)

    AsyncFunction("verifyModel") { (uri: String, bytes: Int, sha256: String) -> Bool in
      try FacePhoto.verifyModel(uri, bytes: bytes, sha256: sha256)
    }.runOnQueue(detectionQueue)
  }

}
