# Independent public face benchmark

## Data and license

The benchmark uses [HyperFace-10k-LDM](https://zenodo.org/records/15087238), a published dataset of generated synthetic identities. The dataset's Zenodo record and the `LICENSE.txt` inside its documentation archive both specify CC BY-SA 4.0. The model-card MIT license is not treated as the dataset license. Attribution and modification notices are retained with the local subset.

[DigiFace-1M](https://github.com/microsoft/DigiFace1M) was considered but not selected because its stated use is non-commercial research. No user photos, private-person identity datasets, or phone enrollment were used.

The subset contains 16 synthetic identities with eight images each. The downloader read 24.7 MiB of the compressed stream, not the full 17.4 GB archive. The subset is selected in archive order, not randomly, and is not representative of real phone photography. Source filenames are renamed, source identity labels are retained in the manifest, and individual image hashes are checked before tests. The full archive checksum is recorded as publisher metadata, not claimed as verified after a partial download.

The first image of each identity is the fixed reference. Other images are held apart as queries. Exact duplicate image content and reference reuse in query fixtures are rejected. Source portraits also produce eight reference-pair test sets containing 392 cases. Two- and three-face cases are artificial portrait mosaics. They test detection, alignment, inference, and pair decisions, but not natural group-scene generalization. Generated fixtures carry their own hashes and remain CC BY-SA 4.0.

## Rerun without supplying photos

```sh
node scripts/test-face-recognition.mjs --public
```

The command downloads the bounded subset only if it is absent, prepares or verifies the fixtures, and runs the actual Aoi face engine and pair scanner. The corresponding package script is `face:benchmark`. Detailed results are written under the gitignored `.expo/face-tests/` directory. Download preparation is separate from inference; tests run over local files and do not upload images.

The downloader limits received compressed data to 128 MiB and has a time limit. It never extracts arbitrary archive paths or symlinks. Original input files, embeddings, and cropped faces are not committed or exported by the benchmark. Embeddings are kept in memory and zeroed during teardown.

## Boundary bug found by the data

Before the fix, 124 of the 128 portraits failed detection parsing, and all eight pair enrollments were blocked. The native Vision observation for one 112px portrait had a box whose bottom reached approximately 123px, despite usable eye, nose, and mouth landmarks inside the image. `parseDetectedPhotoFaces` correctly requires bounded public geometry, but the native adapter did not enforce that contract.

Fix-root-causes changed the implementation choice: clip the published native face box at the adapter boundary, rather than weaken the TypeScript validator or lower the identity cutoff. `FacePhoto.visibleFaceBounds` intersects the normalized box with the visible frame. Landmarks are still computed from the original observation bounds, so their coordinate system and alignment remain unchanged. Observations wholly outside the frame are omitted.

After the fix, all 128 portraits processed successfully, all eight reference pairs were usable, and all 392 pair cases ran without processing failures. The fix is in native source and the compiled Mac helper. It is not installed on the physical phone; that requires a separate dev build. No simulator, phone rebuild, or live library scan was started.

## Measured results at the unchanged 0.72 cutoff

| Test | Accepted or correct | Missed or incorrect | Processing failures |
| --- | ---: | ---: | ---: |
| Same-identity verification | 40 of 112 | 72 rejected | 0 |
| Different-identity verification | 1,680 correctly rejected | 0 false matches | 0 |
| Known face classification in enrolled pairs | 40 correct | 72 missed, 0 assigned to the wrong reference | 0 |
| Unknown face classification in enrolled pairs | 784 correctly rejected | 0 false known identities | 0 |
| Positive artificial pair cases | 13 of 112 found | 99 missed | 0 |
| Negative pair cases | 280 correctly rejected | 0 incorrect additions | 0 |

Same-identity cosine scores had a median of approximately 0.683 and a mean of 0.662. The largest different-identity score was approximately 0.376 in this small subset. These measurements expose poor recall; they do not justify a production cutoff or prove that unseen negatives are safe. No threshold or model was tuned on the subset. Both early and repeated post-fix runs reproduced the listed results.

The face-classification test calls the app's individual `match` function with known synthetic identity labels. The pair test calls `scanPairPhoto`, which requires distinct qualifying faces and excludes ambiguous identities. Failures and blocked enrollments remain separate from successful rejections. The report always sets `readyForProduction` to false.

## Evidence and limits

- Before clipping: `.expo/face-tests/public-benchmark-2F0SiH/report.json`.
- Initial post-fix run: `.expo/face-tests/public-benchmark-ilup0l/report.json`.
- Hash-verified repeat through `--public`: `.expo/face-tests/public-benchmark-T7o08D/report.json`.
- Repeat log: `.expo/crit/public-face-benchmark-final.log`.
- Attribution and selection: `.expo/face-benchmark/hyperface-subset/ATTRIBUTION.txt` and `manifest.json`.

The native verification runner passed clipping regressions, all eight EXIF orientations, and four preprocessing alignment cases with zero pixel error against the reference. Four TypeScript benchmark tests and four offline Python preparation tests passed. The full suite passed 2,557 tests across 242 files with two workers, logged at `.expo/crit/public-face-benchmark-full.log`. Typecheck, scoped ESLint, and whitespace checks passed. Native and inference helpers exited, and compilation scratch directories were removed.

Mac Vision and CPU inference still require iPhone parity validation. Synthetic generator labels and portrait mosaics do not substitute for a real-world benchmark. If this subset is used to choose a model or tune preprocessing or thresholds, a separate untouched validation set is required. The current evidence is a failure report and a repeatable test harness, not a production-readiness claim.
