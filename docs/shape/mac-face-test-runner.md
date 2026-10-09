# Mac recognition test runner

The independent `--public` mode now supplies a licensed synthetic dataset automatically. Its measurements and native boundary fix are recorded in [the public benchmark report](public-face-benchmark.md). Users do not need to supply their own references or test photos for that mode.

## Decision

The user rejected calibration controls inside Aoi and requested testing outside the app. The runner accepts two reference photos and two labeled folders. It produces a local report without a server, app navigation, calibration settings, or exports the user must configure.

Build-the-lever changed the implementation choice: the artifact is a rerunnable local command, not a one-off agent probe. Subtract-before-add removed the need for a second classifier implementation. The runner calls `scanPairPhoto`, including the single-face shortcut and handling of unrelated group-face processing failures.

## Shared code

- `modules/aoi-face-detector/ios/FacePhoto.swift` is compiled unchanged into a headless Mac helper. It owns EXIF decoding, Vision contours, 2048px working-image sizing, and RGB pixel alignment.
- `parseDetectedPhotoFaces` converts contours into the same five-point landmarks used in Aoi.
- `createFaceRecognitionEngine` owns the existing transform, input validation, normalized 128-dimensional output, and serialized embedding work.
- The pinned SFace weights and license are verified before inference. Python uses ONNX Runtime 1.24.3 with its CPU provider, one inference thread, and the same `data` and `fc1` tensor signatures.
- `scanPairPhoto` and `matchPairByCosine` determine the verdict with the unchanged application cutoff. The runner's TypeScript module loader resolves app aliases without changing repository-wide module configuration.

The two test references are independent of protected phone enrollment. Reference input requires one usable face per photo and rejects identical files or cross-reference similarity at the application cutoff. Faceprints remain in process memory. The runner never reads SecureStore, modifies enrollment, rescans the phone library, imports gallery copies, or tunes the cutoff.

## Outputs and limits

Each run creates a private result directory inside the gitignored `.expo/face-tests/`. The HTML report contains local filenames and original-file links, but no embedded photos, scripts, or external resources. An escaped table distinguishes correctly found, missed, incorrectly matched, correctly rejected, failed, and excluded photos. The anonymous diagnostics contain model provenance, actual OS and Vision revision, runtime provenance, per-photo scores, and the fixed-cutoff summary.

Duplicates are checked by streaming content hashes. Exact copies of references cannot inflate results. Conflicting folder copies are excluded. Re-encoded duplicates and near-duplicate captures still require manual exclusion. Failures are excluded from successful positive and negative denominators, never converted to successful rejections. Empty positive or negative folders are rejected.

Folder labels provide ground truth for pair classification, not for the identity of every detected group face. The runner tests the complete detector-to-pair path and provides identifier scores for its embedded faces. It does not establish per-face identifier accuracy. Single-face negatives retain the actual app's embedding shortcut.

Mac Vision results and CPU inference are not guaranteed to match the iPhone's Vision revision or execution provider. The Mac runner narrows detection, preprocessing, reference, inference, and policy problems. A small iPhone parity check is still required before claiming device correctness. A labeled batch at a fixed cutoff is not a calibration or production-readiness certificate. The summary always sets `readyForProduction` to false. Separate held-out photos are required if later engineering changes use the original batch for tuning.

## Ownership and cleanup

Native and inference helpers communicate over local pipes. No network requests occur during photo testing. Helpers have bounded startup and request timeouts. The whole run has a 30-minute lifetime, and cancellation prevents report creation. Teardown closes both helpers, waits for their exit, wipes temporary embeddings and input tensors, and removes native compilation files and synthetic images. Reports persist intentionally. Original images are read-only.

`--setup` is separate from testing because it installs pinned dependencies and may download model files. `--check` compiles the native helper, detects no faces in a generated flat image, prepares native pixels, runs real ONNX inference, and validates the normalized model output. It neither selects personal files nor measures recognition accuracy.

## Verification

- The runner's 11 targeted tests passed. They cover independent references, rejected enrollment, reference cleanup after failure, positive and negative pair verdicts, group-face failures, unchanged cutoff, source-path exclusion, input duplication, empty negative input, HTML escaping, and helper exit and timeout cleanup.
- The album suite passed 276 tests across 30 files. The full suite passed 2,553 tests across 241 files with two workers. The full-suite log is `.expo/crit/mac-face-runner-full.log`.
- `node scripts/test-face-recognition.mjs --check` passed against the actual Swift helper and ONNX model. The app's existing `scripts/verify-face-engine.mjs` passed all eight EXIF orientations and four alignment cases. Pixel errors were zero in those cases, and normalized embedding cosine was approximately one.
- Typecheck and scoped ESLint passed. The synthetic report was exercised through agent-browser, with desktop and narrow screenshots, table semantics, keyboard-focusable original-file links, and the expandable limits section. The browser session was closed and the temporary HTML fixture was removed.
- No personal-photo batch was run. Real accuracy and iPhone parity remain unverified. No app data, enrollment, threshold, or library scan was changed.
