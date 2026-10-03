# Recognition candidate validation

## Decision

Keep the app's current cutoff and single-pass queries. Neither flip fusion nor the lower experimental cutoff passed the acceptance gate. These experiments do not establish near-perfect recognition.

Prove-it-works changed the adoption decision. The candidate improved the original synthetic subset, but flip fusion lost positive pair matches on different identities at the existing cutoff. A lower cutoff also admitted a wrong individual identity. No library rescan, phone rebuild, enrollment replacement, or production activation occurred.

## Primary sources and alternatives

- [OpenCV SFace wrapper](https://raw.githubusercontent.com/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/sface.py) sets cosine cutoff `0.363`. That benchmark-specific value is not a guarantee for Aoi's Vision landmarks or group-photo policy.
- [SFace upstream evaluation](https://raw.githubusercontent.com/zhongyy/SFace/cb5ffb3c4863eecb3abf6a80529daffb05a0e820/SFace_torch/util/utils.py) sums original and mirrored raw outputs before normalization. The lab candidate applies this only to queries so stored references remain single-pass embeddings.
- [OpenCV YuNet license](https://raw.githubusercontent.com/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/LICENSE) is MIT. Its 232,589-byte model is pinned to SHA-256 `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`. Downloaded weights and license stay under `.expo/face-lab/`, outside app assets.

YuNet with OpenCV's SFace alignment found only 7 of 112 positive artificial pair cases at `0.72` on the original subset, compared with Vision's 13. Even at `0.363`, YuNet found only 39, with two portrait processing failures. It was rejected. The publisher-aligned input control tested already-cropped 112px portraits without detection. It is a diagnostic control, not an implementation suitable for a photo library.

## Frozen candidate and split

The first 16 source identities were used for exploration. The candidate was frozen as query-only raw-output flip fusion, cutoff `0.39`, and the unchanged `pair-v2` ambiguity policy before validation. Source identities 16 through 47 form the separate validation set. The downloader skips source identities rather than renaming the original images into a second folder.

The validation set has 256 portraits, 16 enrolled pairs, and 784 artificial classification cases. It is from the same synthetic generator as exploration, selected in archive order. It is not an independent real-world test distribution. The fixtures reuse source portraits across pair/group variants, so the case counts are not statistically independent observations.

## Validation results

| Setting | Positive pairs found | Positive pairs missed | Incorrect negative pair additions | Reference-blocked cases |
| --- | ---: | ---: | ---: | ---: |
| Existing single pass, `0.72` | 36 | 160 | 0 of 490 | 98 |
| Flip-fused queries, `0.72` | 34 | 162 | 0 of 490 | 98 |
| Frozen flip-fused candidate, `0.39` | 180 | 16 | 0 of 490 | 98 |

The lower-cutoff candidate found 91.8% of the 196 positive cases that could run. Across all 224 planned positive cases, including 28 blocked by failed references, it found only 80.4%. Reference failures cannot be excluded from the product's success rate.

At `0.39`, 202 of 208 available same-identity verification checks passed. One of 6,302 available different-identity checks incorrectly passed. An additional 16 same-identity and 642 different-identity checks could not run. Nine portrait processing failures blocked two of the reference pairs. Failed landmark parsing and absent detections remain failures rather than successful negatives.

There were no incorrect negative pair additions, but that does not imply zero risk. A single wrong face match can contaminate a photo containing one actual partner. The synthetic test is too small and too artificial to support bulk automatic additions at the candidate cutoff. No further candidate was selected using these validation results; doing so would require another untouched set.

## Rerun

```sh
# Download different source identities, bounded to 128 MiB of received data.
.expo/face-reference-venv/bin/python -B scripts/prepare-public-face-benchmark.py \
  .expo/face-benchmark/hyperface-validation --identities 32 --skip-identities 16
.expo/face-reference-venv/bin/python -B scripts/prepare-public-face-benchmark.py \
  .expo/face-benchmark/hyperface-validation --build-pairs

# Baseline. No app setting changes.
node scripts/test-face-recognition.mjs --benchmark .expo/face-benchmark/hyperface-validation

# Frozen experimental candidate through the actual pair scanner.
AOI_FACE_LAB_QUERY_FLIP=1 AOI_FACE_LAB_THRESHOLD=0.39 \
  node scripts/test-face-recognition.mjs --benchmark .expo/face-benchmark/hyperface-validation

# Separate OpenCV alignment controls on the exploration subset.
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 \
  .expo/face-reference-venv/bin/python -B scripts/compare-face-alignment.py \
  .expo/face-benchmark/hyperface-subset .expo/face-lab/calibration-alignment.json
```

Reuse existing folders rather than repeating the download. Local experiment flags are read only by the Mac runner. `createFaceRecognitionEngine` defaults to single-pass queries; native app construction does not opt in. Production matching constants remain unchanged. Before any future app activation, query-policy cache versioning, runtime cost, real-photo accuracy, and iPhone parity must be verified.

## Saved evidence

- OpenCV controls: `.expo/face-lab/calibration-alignment.json`.
- Flip exploration: `.expo/face-tests/public-benchmark-TBFdXd/report.json`.
- Untouched baseline: `.expo/face-tests/public-benchmark-mlZtY9/report.json`.
- Untouched flip at `0.72`: `.expo/face-tests/public-benchmark-Y4h5iv/report.json`.
- Frozen candidate: `.expo/face-tests/public-benchmark-GSKsuN/report.json`.
- Candidate log: `.expo/crit/face-candidate-validation.log`.

The embedding engine now clears aligned pixels, mirrored pixels, and raw model outputs after success or failure. Tests cover CHW channel-preserving mirroring, upstream raw-sum fusion, unchanged reference inference, opt-in query inference, and second-inference failure cleanup. These resource-lifetime improvements do not claim better identity accuracy.

Verification passed 2,562 unit tests in 242 files with at most two workers, five offline downloader tests, typecheck, scoped ESLint, and whitespace checks. Source identity labels and image hashes were checked for overlap between exploration and validation; none overlapped. Native preprocessing verification again passed all eight EXIF orientations and four alignment cases with zero pixel error. Logs are `.expo/crit/recognition-candidate-full.log` and `.expo/crit/recognition-candidate-native.log`. Helper processes exited and native scratch directories were removed. No phone rendering or real-world accuracy check was performed.
