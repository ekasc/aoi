# Apple Vision face-detection fallback

## Why a fallback

The current SDK reports default revision 3 for both face rectangles and face landmarks. However, the landmark request's runtime log identifies its internal detector as `VNFaceDetectorRevision2`. Explicit rectangle revision 3 found the missing profile face in a public group photo.

Replacing the detector everywhere was worse for crowded scenes. In the cabinet photo, the landmark request found 15 faces, while rectangle revision 3 found seven. A 76-point landmark constellation did not recover the missing profile face.

Fix-root-causes changed the decision. Preserve the existing detections and use the newer Apple detector only when fewer than two faces were found. Do not replace the recognition model or lower the cutoff to compensate for missed detections.

The SDK declarations were checked in `VNDetectFaceLandmarksRequest.h` and `VNDetectFaceRectanglesRequest.h` under the installed macOS SDK's `Vision.framework/Headers`. Measurements are saved in `.expo/face-lab/apple-vision-probe.ndjson`. This is Mac evidence, not iPhone performance evidence.

## Implementation

`FacePhoto.detectedFaces` first runs the existing landmark request. If it finds fewer than two faces and rectangle revision 3 is supported, it runs that detector. Only additional, nonoverlapping observations receive a landmark request through `inputFaceObservations`.

Original observations and their alignment points remain unchanged. Added observations are also checked against already accepted observations. Boxes that overlap by at least 30% of the smaller box's area are treated as the same face. This conservative deduplication avoids using duplicate detections to establish two identities. It can suppress heavily overlapping real faces, so it is not a completeness guarantee.

The existing quality request receives the combined observations. Failure of an attempted fallback stays a processing failure. Unsupported revisions leave the existing detector in use. The default enables the fallback in native source. The Mac runner also defaults to it; `AOI_FACE_LAB_VISION_FALLBACK=0` selects the legacy baseline for comparisons.

Saved reference model IDs remain unchanged because existing observations and preprocessing are preserved. Scan versions now include `FACE_DETECTION_POLICY_VERSION`, set to `vision-rev3-fallback-v1`. On a future scan, old negative decisions and incompatible checkpoints are reconsidered. Existing imports and removal exclusions remain intact. No live scan was started during this change.

All requests run locally through Apple Vision. The bundled SFace identity model still runs offline through ONNX Runtime. There is no cloud inference, photo upload, vendor service, or new model download.

## Results at the unchanged 0.72 cutoff

On the existing 32-identity synthetic set:

- All 16 reference pairs enrolled. Previously one pair was blocked.
- All 784 pair cases ran, compared with 735 after the preceding contour fix.
- All 560 negative cases were rejected, with no incorrect pair additions.
- Positive pair matches remained 36. The remaining 188 positive cases were missed.
- One portrait still returned no face. Available identity verification checks had no false matches across 6,913 different-identity comparisons. Another 31 comparisons could not run because of that missing portrait detection.

On the four available natural group-photo diagnostics, the profile scene increased from one detected face to two. The original face's score stayed approximately 0.790. The additional profile face scored only approximately 0.310 against its reference, or 0.350 with two references. The photo still failed the pair cutoff. Both reference variants still found only one of four caption-positive photos. Rear-facing targets remain unrecognizable by face identity, and negative downloads for this small natural set remain unavailable.

These results prove detection coverage improved. They do not prove high recognition recall or near-perfect accuracy. The synthetic data has already informed implementation changes and is not untouched validation data.

## Verification

- Actual default-path group report: `.expo/face-tests/public-groups-kwypqC/report.json`.
- Actual default-path synthetic report: `.expo/face-tests/public-benchmark-PfP74T/report.json`.
- Group and synthetic logs: `.expo/crit/apple-vision-group-default.log` and `.expo/crit/apple-vision-synthetic-default.log`.
- Full suite: 2,573 tests passed in 244 files with at most two workers, logged in `.expo/crit/apple-vision-full.log`.
- An initial array-position comparison failed because Vision changed observation order across runs. `scripts/compare-group-face-reports.mjs` now checks one-to-one score preservation independent of order. It passed on the actual before and after reports, with regressions for reordered, missing, changed, and duplicate observations.
- Native regressions cover identical boxes, contained duplicates, separate faces, marginal intersections, and zero-area boxes.
- Swift source passed iOS 15.1 SDK typechecking. No app binary was built or installed.
- Existing native verification passed all eight EXIF orientations and four alignment cases with zero pixel error, logged in `.expo/crit/apple-vision-native-verification.log`.
- TypeScript typecheck, scoped ESLint, and whitespace checks passed. Native helpers exited and compilation scratch directories were removed.

The physical phone still has its previous native binary. iPhone detection parity, runtime cost, and real-photo precision remain unverified. The fallback does not enable production automatic discovery or change its readiness gate.
