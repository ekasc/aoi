# Recognition engine implementation

Status: experimental research, inactive in the product. The integration notes below describe earlier development builds. Current Us reads intentionally shared memories and does not mount recognition. See [relationship home and archive](../product/relationship-home-and-archive.md).

## Fence

Build the engine without exposing automatic discovery. No native app build, simulator, photo-library permission, phone-data mutation, upload, sharing, enrollment UI, or deployment. Native command-line checks may execute pure image helpers without launching an app or opening windows.

## Plan and acceptance

1. Acquire the pinned SFace model with size/hash verification and license retention. Keep the generated binary out of git; preparation is explicit and repeatable.
2. Implement the five-point similarity transform and prove its geometry against known transforms and the OpenCV reference.
3. Add bounded native image preparation, with actual command-line pixel/orientation checks where the installed SDK permits them.
4. Connect the optional detector, image preparation, model session, and pair matcher. Expo Go, unsupported platforms, and incomplete binaries stay unavailable. Serialize native inference and release sessions explicitly.
5. Run a real model through a CPU reference check. Compare reference preprocessing and embeddings without using phone photos. Run affected tests, typecheck, lint, and full regressions with at most two workers.

Do not present mock tests or CPU inference as proof that the Expo native bridge runs on a phone. Enrollment, recognition precision, model threshold calibration, permission lifecycle, and library indexing remain separate gates.

## Implemented

- Pinned SFace weights were downloaded and their exact size and SHA-256 verified. `features/album/sface-model.json` records the artifact. The binary is generated and gitignored; the publisher's license and source README are retained in `assets/models/`.
- `fitFaceAlignment` computes an orientation-preserving least-squares similarity transform to the OpenCV five-point template. Model identity includes the weights hash, contour mapping version, and pixel-preparation version.
- `FacePhoto.swift` contains the real native image/detection implementation used by the Expo module. It handles all eight EXIF orientations, bounds decoded images to 2048 pixels on the longest side, applies the inverse alignment with OpenCV's interpolation convention and black borders, and returns RGB float32 NCHW data without guessed normalization. Transparent source pixels are composited through a premultiplied RGBA buffer.
- The native module exposes detection, pixel preparation, and streaming model verification on one serial background queue. The helper was typechecked against the iOS SDK and executed separately with macOS Apple frameworks.
- `createLocalFaceRecognition` connects the optional native module, bundled assets, ONNX Runtime CPU inference, and the existing pair scanner. It checks weights before creating a session, checks `data:float32[1,3,112,112]` and `fc1:float32[1,128]`, validates input/output buffers, returns normalized embeddings, and releases tensors and sessions.
- The engine serializes work and rejects results after disposal. Missing pixel preparation, missing ONNX Runtime, Expo Go, Android, and web remain unavailable without loading assets. Missing alignment is an embedding failure, not a successful non-match. Callers own engine disposal and must cancel their scan on consent/scope changes.
- ONNX Runtime React Native 1.24.3 and its Expo plugin were added. Model and license asset extensions were registered with Metro. No app screen imports or exposes recognition yet.

## Repeatable verification

On macOS with Xcode command-line tools and a Node version supporting TypeScript stripping:

```sh
pnpm run face:model:prepare
python3 -m venv .expo/face-reference-venv
.expo/face-reference-venv/bin/pip install -r scripts/face-reference-requirements.txt
pnpm run face:verify
```

`face:verify` executes the actual Swift image helper, not a JavaScript duplicate. It checks the real model's hash, runs Vision on a synthetic no-face image, tests pixel samples for all eight EXIF orientations, and compares native crops to OpenCV `FaceRecognizerSF.alignCrop`. It then runs the exact weights through CPU ONNX Runtime and compares embeddings to OpenCV's SFace implementation.

Four generated, person-free fixtures cover identity, scale/translation, clockwise tilt, and counterclockwise tilt. Each produced zero pixel error against the reference and embedding cosine agreement of at least 0.9999998. These values concern numerical implementation agreement; they are not recognition accuracy or a product matching threshold.

Results are retained in `.expo/face-engine-verification/reference-results.json`. The runner bounds each child to 120 seconds, cleans its scratch run directory, and leaves no server or daemon. The generated model and reference Python environment remain for reruns. No phone photos were read or seeded.

## Checks run

- 178 album tests across 15 files passed, including model integrity, alignment, inference serialization, missing capabilities, loading Retry, malformed tensors, session/tensor cleanup, disposal, and pair-scanner integration.
- Full regression suite: 2,450 tests across 226 files passed with at most two workers. Log: `.expo/crit/face-engine-full.log`.
- App typecheck and scoped ESLint passed.
- iOS SDK typecheck of `FacePhoto.swift`, Expo module Swift syntax parsing, and podspec Ruby syntax passed.
- Expo public config evaluation and native autolinking config passed; the ONNX Runtime iOS podspec was discovered.
- Accessibility audit: 110 files, zero findings. No UI changed in this slice.
- `git diff --check` passed.

## Remaining gates

The Expo module registration and ONNX Runtime React Native bridge still need a native app build and device execution. CLI execution of Apple frameworks does not prove those bridges work. Real face contour extraction and its agreement with the SFace five-point convention remain unverified; no consented-person fixtures or real-library precision/recall tests have been run.

High-resolution downsampling, small/profile/blurred faces, similar identities, memory/battery behaviour on the phone, enrollment consent and storage, model-version migration of faceprints, calibrated thresholds, gallery permissions/indexing, and encrypted sharing remain pending. The current engine is not exposed to users and cannot automatically select or upload photos.

## Physical iPhone dev build

The user requested a dev build and clarified that it must be installed on the phone, not a simulator. An initial simulator build succeeded while the phone appeared offline; that simulator was subsequently shut down and its generated build directory removed. No simulator remains booted.

Once the physical iPhone connected over USB, the personal-team configuration was regenerated with `AOI_DEV_NO_CAPABILITIES=1`. This uses the existing `com.ekasc.aoi.dev` bundle identifier and omits push and Apple Sign-In entitlements. No app was uninstalled and no phone data was erased or seeded.

The arm64 Debug device build succeeded with automatic development signing and two build workers. `devicectl` installed it on the physical iPhone and launched it against LAN Metro. The app connected as `com.ekasc.aoi.dev (iPhone)`. Its screenshot showed the signed-in Memories screen, not a dev preview or seeded flow. A short log capture contained startup/deprecation warnings but no captured runtime exception. Live JavaScript inspection confirmed that `AoiFaceDetector` and its `detect`, `prepareFace`, and `verifyModel` methods are registered.

Logs: `.expo/crit/dev-phone-xcode-resume.log`, `.expo/crit/dev-phone-install.json`, `.expo/crit/dev-phone-launch.json`, `.expo/crit/dev-phone-metro.log`. Phone screenshot: `.expo/aoi-debug/screenshots/2026-10-02T05-38-54-049Z-fqu2km.jpg`. The accessibility inventory still returned zero elements and is not a VoiceOver check.

The native Expo module compilation and registration gates have now passed. CocoaPods selected `onnxruntime-c` 1.30.0 for the React Native package's unversioned native dependency; CPU reference checks used ONNX Runtime 1.24.3. Recognition session creation, device inference/parity, and real-photo accuracy remain unverified. No library access or face scan was performed. Metro remains running for the requested dev session.

## Automatic discovery integration

Session creation and native inference/parity have since passed on the physical iPhone, using a rerunnable person-free fixture check. One-time enrollment and automatic device-local discovery are now accessible in the real Us screen of the dev build. See [automatic album wiring](automatic-album.md) for the current scope, executed checks, and shared-sync/accuracy gates. No agent-driven enrollment, gallery scan, or upload occurred. The experimental discovery provider is disabled in production builds.
