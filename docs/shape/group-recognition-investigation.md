# Group-photo recognition investigation

The subsequent [Apple Vision fallback investigation](apple-vision-face-fallback.md) recovered all reference pairs on the synthetic set and the missing profile detection. Identity recall remained poor. The results below describe the preceding contour-only implementation.

## What changed

Five synthetic portraits failed because Vision placed unused lower-lip contour points below the image. Their actual eye centers, nose tip, and mouth corners were still inside it. The old parser rejected the entire detection before alignment.

`parseFaceLandmarkRegions` now permits finite outer-lip contour coordinates beyond the image, then validates the five selected alignment points. It does not clip contours, substitute corners, or accept an alignment point outside the image. Eye and nose contour validation remains unchanged. Missing visible mouth corners produce unavailable landmarks rather than invented geometry.

Fix-root-causes changed the choice: validate the coordinates actually used by alignment instead of lowering the identity cutoff to compensate for a parsing failure. Previously accepted inputs keep the same five points and embeddings. Enrollment compatibility and matching constants remain unchanged.

## Synthetic regression evidence

On the existing 32-identity validation set, processing failures fell from nine to four. The remaining four are successful no-face detections, not malformed contour data. One failed reference pair recovered. Blocked cases fell from 98 to 49, and attempted cases increased from 686 to 735.

At the unchanged `0.72` cutoff, the current single-pass engine found 36 of 210 attempted positive cases and rejected all 525 attempted negative cases. Recovering detection does not establish improved recognition recall. The additional reference pair still did not produce a qualifying match. This validation set has already informed fixes and must not be called untouched for subsequent candidate selection.

Evidence is `.expo/face-tests/public-benchmark-h97nkJ/report.json` and `.expo/crit/face-contour-validation.log`. The raw failure probe is `.expo/face-lab/failed-detections.ndjson`.

## Natural group-photo diagnostics

`scripts/prepare-public-group-benchmark.py` defines a small caption-labeled public-figure set using Wikimedia Commons. The labels come from publisher descriptions, not model predictions. The set uses public figures rather than private people's face datasets.

The catalogue specifies four reference portraits and seven query photos. Each image is checked against its publisher SHA-1 before local storage. SHA-256, source page, caption basis, author, and license metadata are retained in `sources.json`. Accepted image licenses are public domain, CC BY 3.0, and CC BY 4.0. The images are not bundled in Aoi or used for advertising or endorsement. Commons metadata is not a substitute for all possible non-copyright rights.

Eight images totaling 10.4 MiB were available: four references and four positive queries. Wikimedia returned rate limits for subsequent requests. The downloader stopped and retained the missing cases explicitly. Long requested pauses are not retried. `--offline` finalizes the available local evidence without further requests. Three planned images remain unavailable, including both negative queries.

The actual Mac Vision and pinned SFace pipeline ran identical queries with one reference per person and two references per person. At `0.72`, both variants found one positive photo and missed three, with no enrollment or processing errors. Multiple references improved the best scores in the qualifying cabinet photo from approximately `0.797/0.759` to `0.830/0.800`, but did not change the verdicts.

Two queries contain a rear-facing target whose facial identity cannot be established reliably from the image. Another contains a profile target that Vision did not detect. A face-only pipeline cannot guarantee every photograph containing both people, especially when a face is invisible. These caption-positive cases remain misses; they are not removed to inflate the result.

There were no negative checks, so false-positive rates are null. This set is a diagnostic, not a held-out accuracy benchmark. No safety conclusion follows from it.

Evidence is `.expo/face-tests/public-groups-lhbuZh/report.json`, `.expo/crit/public-groups-final.log`, and `.expo/face-benchmark/public-groups/sources.json`. The inspected contact sheet is `.expo/face-lab/public-group-contact.jpg`.

## Model licensing findings

- [InsightFace's commercial licensing page](https://www.insightface.ai/solutions/face-recognition-licensing) explicitly distinguishes MIT code from separately licensed weights. `buffalo_l`, `antelopev2`, and smaller packages require commercial permission. No weights were downloaded or adopted.
- [The AdaFace IR18 WebFace4M model card](https://huggingface.co/minchul/cvlface_adaface_ir18_webface4m/raw/main/README.md) instructs users to follow the training dataset license. [CVLFace's MIT code license](https://raw.githubusercontent.com/mk-minchul/CVLface/main/LICENSE) does not remove that instruction. Its checkpoint is not cleared for Aoi by this investigation.
- [GhostFaceNet's README](https://raw.githubusercontent.com/HamadYA/GhostFaceNets/main/README.md) lists MS1MV2 and MS1MV3 training data. [Its MIT license](https://raw.githubusercontent.com/HamadYA/GhostFaceNets/main/LICENSE) is evidence about the repository, not sufficient evidence that all training-data rights allow Aoi's commercial deployment. Checkpoint permission remains unresolved.

The next model comparison needs documented checkpoint permission, followed by new visible-face positives and difficult negatives. Published LFW accuracy cannot stand in for group-photo recall. A commercially licensed model may improve profile recognition, but cannot establish identity from a hidden face.

## Verification and limits

The full suite passed 2,568 tests in 243 files with two workers. Five public-group downloader tests and five synthetic downloader tests passed offline. Typecheck, scoped ESLint, native EXIF and alignment parity, and whitespace checks passed. Native preprocessing still had zero pixel error on all four reference alignment cases.

Checks are logged in `.expo/crit/group-recognition-full.log` and `.expo/crit/group-recognition-native.log`. Helper processes exited and scratch directories were removed. No phone rebuild, library scan, enrollment replacement, or cutoff change occurred. iPhone parity and broader real-photo accuracy remain unverified.
