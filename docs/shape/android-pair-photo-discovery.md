# Android pair-photo discovery

## Decision

Use a bundled face detector through ONNX Runtime, followed by the existing bundled SFace identity model and shared distinct-face pair policy. YuNet is a viable detector candidate, not an accuracy-approved replacement for Apple Vision.

Android recognition is not implemented or enabled by this investigation. No Android build, emulator, physical device, enrollment, or library scan was started. Production automatic discovery remains gated.

The privacy boundary changed the detector choice. ML Kit processes photos locally, but its [terms](https://developers.google.com/ml-kit/terms) say its APIs send performance and utilization metrics to Google and may contact Google for updates. Do not add ML Kit or Play Services model delivery to Aoi's recognition path.

## Model and license evidence

The [OpenCV Zoo YuNet README](https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/README.md) explicitly licenses all files in its detector directory under MIT. The [directory license](https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/LICENSE) permits distribution and sale with its copyright and permission notice included. This is checkpoint-directory evidence, unlike inferring weight rights from an unrelated code license. Preserve the license in any eventual bundled assets.

The prototype uses the existing lab copy of `face_detection_yunet_2023mar.onnx`, not a new app asset. Its size is 232,589 bytes and SHA-256 is `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`. The source README now also describes a dynamic-shape 2026 export; that export was not downloaded or tested here.

The tested checkpoint takes raw BGR float32 pixels in `[1,3,640,640]`. It returns classification, objectness, boxes, and five landmarks at strides 8, 16, and 32. The app's existing SFace model consumes aligned RGB `[1,3,112,112]` tensors and produces 128-dimensional embeddings. These preprocessing contracts must remain separate.

[ONNX Runtime React Native](https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html) supports Android and is already a project dependency. Runtime support does not establish model accuracy or native preprocessing parity.

## Executable prototype

`scripts/probe-android-face-backend.py` runs the detector through CPU ONNX Runtime without ML Kit, then compares its decoder against OpenCV's reference implementation. It accepts only the pinned model checksum and source-ledger image hashes. Comparison is one-to-one and ignores detector output order. It clears input and output float buffers after inference, including failure paths. This diagnostic does not establish deletion of every decoded image copy from memory.

Run it against the existing public catalogue:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  .expo/face-reference-venv/bin/python -B scripts/probe-android-face-backend.py \
  .expo/face-benchmark/public-groups .expo/face-lab/yunet.onnx \
  .expo/face-lab/android-detector-probe.json
```

All four available caption-positive group images ran. Maximum coordinate/confidence difference from OpenCV was approximately 0.000031. At detector confidence 0.9, face counts were 2, 2, 1, and 2. At the exploratory detector confidence 0.6, counts were 23, 4, 2, and 6. Counts alone do not identify the intended people or distinguish extra false detections. Neither confidence is an approved app setting, and neither changes the identity cutoff of 0.72.

The crowded scene demonstrates a coverage problem at the stricter detector setting. Previous YuNet alignment experiments also performed worse than Vision on artificial groups. Do not claim parity or activate this model based on successful inference alone.

## Bounded implementation sequence

1. Add the Android implementation under `modules/aoi-face-detector/android/` and register it in `expo-module.config.json`. Decode local file and authorized MediaStore content URIs, normalize all EXIF rotations/reflections, and supply aligned pixel tensors and local crop previews. Never open an HTTP image URI. Prefer MediaStore IDs/content URIs over relying on unrestricted filesystem paths under scoped storage.
2. Bundle the pinned detector and its license. Run serialized inference and validate tensor names/shapes, finite outputs, box geometry, and landmark bounds. Apply nonmaximum suppression before passing detections to identity matching. Android cannot provide Apple's capture-quality score; do not invent an equivalent confidence value or hide unsupported assessment.
3. Connect the Android detector and SFace engine through the existing recognition contracts. Remove the iOS-only native-module gates only after Android exports those contracts. Reuse `scanPairPhoto` and the two-distinct-face policy. Keep the 0.72 identity cutoff and production readiness gate unchanged. Version Android detector/alignment policy in scan caches. Do not assume enrollment portability merely because both platforms use SFace.
4. Verify photo-library ordering, relationship-date boundaries, limited access, revoked permissions, and local-only asset availability on Android. Existing Expo media-library code is a starting point, not tested parity. Android selected-photo access must not be represented as access to the whole library. Full-library permission also needs a separate Google Play policy review.
5. For a user-started scan that survives app switching, move scanning work into a native worker with durable checkpoints and a visible cancel/progress notification. A foreground service does not by itself keep the React Native JavaScript scan alive. Android 15+ offers `mediaProcessing` foreground services with time limits; older-version service type selection and store declarations need explicit review. WorkManager can schedule bounded incremental checks, but does not guarantee immediate discovery or unrestricted execution. Do not describe this as continuous background scanning.

The [Android foreground-service type documentation](https://developer.android.com/develop/background-work/services/fgs/service-types) defines media-processing use cases, API availability, permissions, and timeout handling. The chosen service must actually own the processing and stop cleanly at cancellation, timeout, or loss of permission. Future photos require incremental scheduling and deduplication, not an indefinitely running timer.

## Acceptance gates

- Run shared pair-policy regressions unchanged, including unrelated group faces and ambiguous identities.
- Compare Kotlin EXIF handling, landmark mapping, affine sampling, pixels, and embeddings against pinned native reference cases. Use tolerance-based pixel/embedding checks and publish any platform differences.
- Run new held-out public positives and difficult negatives through actual Android inference. Include profiles, small crowded faces, low light, occlusion, and explicit rear-facing misses. Mac detector execution is not this test.
- Check enrollment, photo-check crops, cancellation, pause/resume, permissions, heat/low-power behavior, and app switching on a real Android device without resetting personal data.
- Verify release recognition with network disabled and inspect dependencies/network traffic for telemetry. Source selection alone is not a runtime network audit.
- Record both false additions and recall before enabling discovery. Zero observed false additions on a small dataset is not a zero-risk claim.

## Current result

A local, commercially distributable detector route exists and its tensor decoder ran against real public images. Android integration, device performance, background execution, recognition accuracy, release network auditing, and full-library policy approval remain unverified.
