# Us gallery discovery

## Scope

Us draws from local photos of the pair, not saved memories. Tapping the sky brings a photo forward from a star. Discovery is separate from sharing. Selecting a photo does not create a memory, send a response, or upload anything.

Automatic recognition is not implemented. The current face pipeline contains interfaces and cosine-matching helpers, but no native detector, embedding model, or enrollment flow. The first working slice uses explicit selection through the system picker and says so. It must never claim to have scanned or recognized faces.

## Plan

1. Inspect the existing sky, album, picker, viewer, and persistence paths.
2. Build scoped local photo storage and import/remove recovery tests.
3. Replace the Us memory source with local photos, preserving the sky and existing letter/Squeeze controls.
4. Exercise empty, populated, failure, persistence, and reveal flows in an isolated browser. Run targeted tests, full regressions with two workers, typecheck, accessibility audit, and lint.

No native build, phone-data write, library-wide permission request, remote upload, deployment, or git mutation is in scope.

## Storage choice

Two possible shapes:

- Store library asset identifiers and resolve original photos when tapped. This would need standing library access, permission-change handling, iCloud retrieval, and missing-asset recovery before the basic interaction worked.
- Import only explicitly selected photos into device-local storage. This works with the system picker, without requesting full-library access. Copies remain available across launches and are removed independently of the original photo.

Choose local copies for this slice. Explain that the copies are on this device and that removal does not delete the phone's originals. Native copies live in the app's document directory; browser copies live in IndexedDB. Metadata is scoped by signed-in user and space. Images are re-encoded before persistence rather than retaining original EXIF/location metadata.

The existing encrypted album contracts remain separate. They describe explicit sharing and recovery, not local library discovery. No nonexistent album API is called and no shared entitlement is inferred from a local photo.

## Caller and types

The Us screen uses `useSkyPhotos()` for load/import/remove state. It knows neither storage paths nor picker temporary-URI lifetime. It passes local photo URIs to the existing viewer, without a memory navigation action or response composer.

`SkyPhoto` contains an id, display URI, dimensions, and import time. `SkyPhotoRecord` contains the durable metadata but no original library URI, location, faceprint, or remote URL. `SkyPhotoScope` contains the user and space ids. A repository reads, imports, and removes only its scope.

The sky consumes minimal star items rather than fabricating Moments from photos. Memories callers retain their current behaviour. The explicit discover control is the accessible alternative to tapping the sky.

## Acceptance gates

- Successful empty reads, loading, read failure, picker cancellation, import failure, and missing image are distinct.
- No Memories fallback, automatic seeds, uploads, fake pair matching, or shared response controls.
- Photo selection and removal are guarded during writes; failed imports do not leave visible phantom photos.
- Scope changes immediately hide the previous scope's photos and invalidate late callbacks.
- Reload restores local photos; removal leaves original photos untouched.
- With multiple photos, successive discoveries do not repeat the last photo.
- The viewer grows from a small star origin and respects its existing reduced-motion handling. Native gesture fidelity remains a device gate.

## Remaining work

Native model selection and validation; consent and enrollment for both identities; pair matching within one image; resumable on-device indexing; permission changes and library changes; battery/memory limits; correction/exclusion controls; explicit encrypted sharing and the album backend. None is implied by this manual-selection slice.

## Implemented and verified

The local-selection slice is implemented. Us no longer reads Moments. The system picker imports up to 12 explicitly selected images per batch. Re-encoding bounds the longest side to 2048 pixels, and a content hash prevents duplicate copies. Imports roll back staged files after failure. Missing copies remain removable. The selection list is virtualized.

Account and space scope changes hide previous photos and reject late selection results. Photos without a memory id use the existing viewer without an Open memory action or response composer. The sky has a named button and a visible discovery action. Sharing remains disconnected.

Checks on October 1, 2026:

- Targeted album, Us, and viewer tests: 121 passed across 9 files.
- Full unit regression run, sequential with at most two workers: 2,351 passed across 217 files. Log: `.expo/crit/us-gallery-full.log`.
- App TypeScript check passed.
- Accessibility audit: 110 files scanned, zero findings.
- Scoped ESLint passed for new album files, local selection sheet, Us screen, day-sky models, and sky palette.
- Shared sky/viewer lint still reports the committed baseline: sky has one warning; viewer has ten errors and two warnings. These files do not have a clean lint gate.
- `git diff --check` passed.
- `agent-browser` exercised the actual web picker/import pipeline, duplicate selection, persistence after reload, removal to empty, two successive different reveals, and injected local-read failure followed by Retry. Inspected small-screen dark and larger-screen screenshots. Only isolated browser fixtures were selected, never phone-library data. Removed the browser copies and closed the verification browser. Existing user-requested Metro/API servers remain running.

The phone screenshot showed the real empty Us screen. Native picker permissions, image re-encoding and EXIF removal, persistence, zoom/reveal gestures, reduced motion, Dynamic Type, and VoiceOver still require device verification. The native accessibility capture returned zero elements and cannot prove VoiceOver support.

These are sandbox-local copies, not the encrypted shared album. OS backups are outside Aoi's upload path. Automatic account-deletion cleanup of local copies is not wired into this slice; manual removal is available. No backend, native build, deployment, commit, or push was performed.

## Pair-matching slice

`matchPairByCosine` now checks embeddings for distinct detected faces within one photo. Both identities must be enrolled. Each person needs a separate face above the similarity threshold; a face above the threshold for both identities cannot establish either one. Other faces may appear in the photo. Missing identities, ambiguous matches, or malformed model vectors return `unsure`; an empty detection result returns `no-faces`.

The result includes the two face indices and cosine similarities, not probability estimates. It uses the existing default threshold of 0.72 unless the caller supplies one. That default remains uncalibrated against a real library and is not evidence that recognition is accurate. The caller must supply distinct detector outputs from a single photo. This helper cannot verify the detector's boxes or provenance.

Boundary discipline determined the implementation: validate native embedding vectors before comparisons, so NaN, infinite, zero, or mismatched vectors cannot qualify a photo. No enrollment UI, model, gallery scanning, sharing, or Us behaviour changed in this slice.

Verification: all 11 new tests failed before the helper existed, then passed with the implementation. All 90 album tests across seven files passed. App typecheck, scoped ESLint for the helper and test, and `git diff --check` passed. Logs: `.expo/crit/pair-match-red.log`, `.expo/crit/pair-match-green.log`, `.expo/crit/pair-match-album.log`. Native recognition remains untested because no model is wired in.

## Single-photo scan slice

`scanPairPhoto` now coordinates the existing `FacePipeline` interface with the pair matcher for one supplied photo. It requires both enrolled identities, checks native model availability, detects faces, and embeds each face sequentially before calling the real pair matcher. The old single-face `pipeline.match` method is not sufficient for pair discovery and is not used here.

The result distinguishes missing enrollment, unavailable model, cancellation, and native failures during availability, detection, or embedding from a successful `pair`, `unsure`, or `no-faces` result. Failures contain only the stage, never the source URI or native exception text. The function does not import, persist, upload, or share photos.

Boundary discipline keeps model failures distinct from successful non-matches. Sequential embedding also limits concurrent native work. Cancellation is checked before native access and after every awaited call, including between faces. It prevents subsequent work and discards results, but cannot interrupt an in-flight native call because the current pipeline interface has no cancellation parameter. Callers must abort when consent or scope changes.

Verification: 14 single-photo scan tests and all 104 album tests across eight files passed. Tests supply detector/embedding doubles and run the real pair matcher; they prove orchestration, not native recognition accuracy. App typecheck, scoped ESLint, and `git diff --check` passed. Logs: `.expo/crit/scan-pair-targeted.log`, `.expo/crit/scan-pair-album.log`. The initial pre-implementation run failed to import the absent module, so it did not execute assertions.

No UI or phone data changed. A working native detector, embedding model, enrollment, and gallery indexing are still absent. The next device-capable step needs a chosen and licensed model plus a native image-detection adapter; this coordinator alone does not make gallery discovery available.

## iOS still-photo detector slice

Added the local Expo module `modules/aoi-face-detector`. Its Swift source uses Apple Vision's face-rectangle request on a supplied local file. ImageIO generates an orientation-corrected thumbnail bounded to 2048 pixels before detection. Boxes map back to full-resolution, orientation-corrected image coordinates with a top-left origin. Roll is in degrees or null when Vision has no estimate. These boxes do not identify either person.

The TypeScript adapter rejects remote or unresolved library URIs, validates native dimensions and boxes, and strips unrequested metadata. Native exception text cannot escape with private filenames. The optional module reports unavailable in existing binaries without it, including Expo Go; Android and web remain unavailable. No app screen consumes it yet, and `FacePipeline` does not claim identity availability merely because detection exists.

Boundary discipline shaped the bridge: native output must pass validation before callers can use it as face geometry. No photo-library entitlement or permission flow was added. There is no image upload, model download, enrollment, persistence, or faceprint generation.

Verification:

- 27 new adapter/platform tests and all 131 album tests passed. The tests double the native bridge; they do not run Vision.
- Full regression suite passed: 2,403 tests across 221 files, at most two workers. Log: `.expo/crit/face-detector-full.log`.
- App typecheck, scoped ESLint, Ruby podspec syntax, Swift syntax parsing, and `git diff --check` passed.
- Expo autolinking search and resolve both found `AoiFaceDetector`, its podspec, and `AoiFaceDetectorModule`. Log: `.expo/crit/face-detector-resolve.log`.

No native build or CocoaPods install was run. Swift parsing does not check API types or linkage. Native compilation, real-file decoding, rotated/mirrored image geometry, small faces, memory use, and actual detection accuracy remain unverified. The existing phone binary has no new module until rebuilt. Identity embeddings, enrollment, and library indexing remain separate pending work.

## Model selection

The next documentation-only slice selected OpenCV Zoo SFace ONNX for a local prototype. Publisher licensing, exact artifact identity, reference preprocessing, runtime candidate, and unverified gates are recorded in [the model decision](../decisions/face-identity-model.md). InsightFace-distributed recognition weights were rejected because their policy restricts them to non-commercial research. No weights or runtime dependency were added.

SFace requires five-point alignment. The current Vision rectangles are insufficient for its reference preprocessing, so the next code slice must add landmarks rather than claim that a box crop implements identity recognition. Neither the existing 0.72 threshold nor the upstream demo threshold is calibrated for Aoi.

## Landmark extraction slice

The iOS module now uses `VNDetectFaceLandmarksRequest` and returns eye contours, nose crest, and outer lip contours in the same full-resolution oriented pixel coordinates as its face boxes. The bridge validates all point coordinates before reducing them to five alignment estimates: image-left eye center, image-right eye center, lower nose-crest point, and the two outer-lip extremes along the eye axis.

Eye centers use contour centroids rather than pupil estimates. Nose and mouth points use axes derived from the eyes rather than image x/y extrema, so moderate head roll does not change which contour points are selected. This is a proposed mapping of Vision contours to the SFace convention, not verified parity with YuNet landmarks or OpenCV crops.

Missing contours or degenerate/inverted geometry produce `landmarks: null`; they never manufacture alignment points. A face box remains visible to callers when its landmarks cannot be used. Older binaries that return boxes without landmark regions also produce null landmarks. Invalid native points fail validation instead of becoming valid-looking geometry. No pixels are cropped and no embeddings are computed in this slice.

Checks: 45 targeted landmark/detector tests and all 152 album tests across 11 files passed. App typecheck, scoped ESLint, Swift syntax parsing, and `git diff --check` passed. Tests cover point order, swapped anatomical region names, tilted axes, missing contours, collapsed/inverted geometry, nonfinite/out-of-image points, and non-mutation. Logs: `.expo/crit/face-landmarks-targeted.log`, `.expo/crit/face-landmarks-album.log`.

SDK headers and Swift overlays were inspected for the Vision contour APIs. No native app build or Vision execution occurred. Coordinate conversion on actual images, contour estimates versus the SFace reference, and native compilation remain unverified. The next code slice is the five-point similarity transform and its reference geometry tests; actual image-warp parity and model inference must follow before enabling recognition.

## Larger engine slice

The [recognition engine](us-recognition-engine.md) now connects alignment, native pixel preparation, verified SFace weights, ONNX Runtime inference, and the pair scanner. Native helper execution and real-model CPU reference checks passed on synthetic fixtures, including all EXIF orientations. The Expo phone bridges and recognition accuracy remain unverified. Us still uses explicit gallery selection, with no enrollment UI, automatic indexing, uploads, or recognition-based inclusion.

## Automatic local discovery

The dev build now exposes one-time enrollment and automatic local scanning from Us. The physical iPhone inference pipeline also passed a real OpenCV reference comparison on synthetic images. Both enrolled people must be present; group photos qualify, including when an unrelated face cannot be aligned. Production automatic discovery, real-photo accuracy, and partner sharing remain gated. See [current implementation and verification](automatic-album.md).
