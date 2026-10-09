# iPhone recognition parity and alternative baseline

## Scope

The installed `com.ekasc.aoi.dev` build was tested through its real native face detector, crop preparation, and ONNX recognition engine. Only synthetic fixtures and the existing eight-image public-figure catalogue were transferred into temporary app cache files. No personal library asset, saved enrollment, relationship setting, matching cutoff, or scan checkpoint was read or changed by these diagnostics. This is not a fix for the observed zero-addition library scan.

Build-the-lever changed the approach. `scripts/verify-phone-public-faces.mjs` makes the physical-phone comparison repeatable, rather than relying on a screenshot or a successful Mac test. It compares fixed landmark crops separately from the phone's own detected landmarks.

## Synthetic controls

`pnpm run face:verify:phone` passed identity and tilted alignment fixtures on the installed phone. Cosine agreement was above 0.99999999999 and maximum embedding-component error was below 0.0000016. The synthetic image correctly produced no faces. The scratch image was removed.

Evidence: `.expo/crit/ios-phone-parity.log` and `.expo/face-engine-verification/phone-results.json`.

## Original public images

The new runner verifies public inputs against `.expo/face-benchmark/public-groups/sources.json`, then serves only those verified bytes and reference crop tensors over a short-lived tokenized LAN endpoint. Recognition runs locally on the phone and Mac. Phone scratch photos are deleted and inference sessions released per image. The Mac server, native helpers, and compilation directories are torn down afterward.

All eight images completed, with 25 usable fixed landmark crops. Face counts matched between Mac and phone for every image. This does not prove that every detected box or landmark coordinate is identical.

The strict original-image preprocessing comparison **failed**:

- Some fixed JPEG crops differed by one to three pixel values. One crop had a maximum difference of 13 and a mean difference of approximately 0.86.
- Minimum cosine agreement on fixed crops was 0.9991714. Maximum embedding-component error reached approximately 0.0119.
- Other JPEG inputs had zero crop-pixel difference and embedding agreement above 0.99999999999.

The original-image failure is retained in `.expo/face-engine-verification/phone-public-results.json`; do not label it a parity pass. A first harness attempt also failed because Hermes did not return an awaited promise's value through CDP. The runner now reads an explicit bounded diagnostic result, as the existing synthetic runner does. A later shell timeout left a compilation directory, which was removed. The runner now has cancellation and an eight-minute lifetime.

Both actual pipelines made the same four positive-photo decisions at the unchanged 0.72 cutoff. One matched and three did not. Best target similarities were:

| Public query | Mac target scores | iPhone target scores | Both verdicts |
| --- | --- | --- | --- |
| Cabinet group | 0.797, 0.759 | 0.798, 0.769 | Pair |
| Oval 2012 | 0.100, 0.638 | 0.088, 0.656 | Unsure |
| Oval 2015 | 0.790, 0.310 | 0.778, 0.313 | Unsure |
| Advisors group | 0.027, 0.397 | 0.048, 0.415 | Unsure |

These are small diagnostic results, not accuracy estimates. The available public queries have no difficult negatives. Caption positives that contain rear-facing targets remain misses rather than being excluded to improve the score.

## Lossless isolation control

The runner's `--lossless` option re-encodes the same public sources into RGB PNG using OpenCV before either device sees them. These are labeled re-encoded controls, not untouched originals or a new validation set.

All 25 fixed crops were pixel-identical on Mac and iPhone. Minimum fixed-crop embedding cosine was above 0.99999999999. The lossless run passed the strict preprocessing/inference limits, yet both pipelines still found only one of four positive photos.

The experiment isolates the observed crop discrepancy to the JPEG decode/render path rather than the affine sampler or ONNX inference for these inputs. It does not identify a particular ImageIO decoder implementation defect. Platform differences in detected landmark coordinates can still affect identity scores, even when fixed-landmark tensors agree.

The JPEG discrepancy did not change any of these four verdicts. This evidence does not establish why the user's complete library scan added nothing, or rule out larger differences on HEIC, HDR, wide-gamut, or other inputs. It does show that replacing the iPhone runtime alone is not a demonstrated solution.

Evidence: `.expo/face-engine-verification/phone-public-lossless-results.json` and `.expo/crit/ios-public-phone-lossless.log`.

Run both checks while the existing phone app is foregrounded on Us, without restarting or rescanning it:

```sh
AOI_PHONE_LAN_HOST=<Mac-LAN-IPv4> OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  node --experimental-strip-types scripts/verify-phone-public-faces.mjs

AOI_PHONE_LAN_HOST=<Mac-LAN-IPv4> OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  node --experimental-strip-types scripts/verify-phone-public-faces.mjs --lossless
```

The original-image command currently exits nonzero because of the retained strict comparison failure. A phone disconnect or cancellation cannot prove immediate remote cache cleanup; its asynchronous diagnostic job owns cleanup in `finally`.

## Alternative dlib baseline

The [model author explicitly releases the model files into the public domain](https://raw.githubusercontent.com/davisking/dlib-models/master/README.md). This is checkpoint-specific evidence, not an inference from a library's code license. The README also discloses mixed training sources, including VGG, FaceScrub, and internet images. The author's model permission is not a legal determination about every training image or every deployment jurisdiction.

The lab pinned publisher revision `fd81b6308a6a73d4ce08859eb2f4b628a21e27a2`, verified Git blob identities and byte counts for both downloaded files, and saved local SHA-256 hashes and license evidence. The recognizer and five-point landmark predictor are kept under `.expo/face-lab/dlib/`, not bundled in the app. The restricted iBUG-trained 68-point model was not downloaded.

`scripts/compare-dlib-public-groups.py` keeps Aoi's Vision detections, then uses dlib's five-point alignment and 150px recognition crops. This compares recognition plus alignment, not isolated neural-network weights. dlib 20.0.0 was compiled with at most two workers. Inference used bounded CPU settings.

The [publisher's example](https://raw.githubusercontent.com/davisking/dlib/v20.0/examples/dnn_face_recognition_ex.cpp) uses Euclidean distance strictly below 0.6. That is not SFace cosine similarity and does not replace the app's 0.72 cutoff. `scripts/classify-dlib-report.mjs` maps qualifying distances into scores and uses Aoi's actual shared two-distinct-face policy.

Result: dlib also found only one of four available positive photos, with either one or two references per person. Its recovered profile target remained outside the experimental distance boundary. No negative-case precision estimate is available. **Do not adopt dlib from this experiment; it did not improve these verdicts.**

Rerun the cached baseline:

```sh
CMAKE_BUILD_PARALLEL_LEVEL=2 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  .expo/face-reference-venv/bin/python -B scripts/compare-dlib-public-groups.py
```

Evidence: `.expo/face-lab/dlib/models.json`, `report.json`, `policy-report.json`, and `.expo/crit/dlib-public-groups.log`.

## Stronger commercial options

The [InsightFace upstream README](https://raw.githubusercontent.com/deepinsight/insightface/master/README.md) restricts released recognition weights to noncommercial research and supplies a separate commercial licensing contact. The [commercial services page](https://www.insightface.ai/services/face-recognition-licensing) offers licensed recognition models and an iOS-capable InspireFace SDK. No separate license was obtained, so those weights were not downloaded or tested.

[Luxand FaceSDK](https://www.luxand.com/facesdk/) explicitly describes on-device execution without an internet connection and iOS support. Its documentation requires library activation with a license key. Offline execution claims do not prove the absence of telemetry, license calls, or SDK update traffic. It is a paid evaluation candidate, not an approved dependency or demonstrated accuracy improvement.

The next modern-model comparison needs checkpoint-specific commercial evaluation rights, explicit offline deployment terms, and a release-network audit. No account was created, vendor contacted, purchase made, or license key requested during this investigation. Current evidence does not justify a model swap or lowering the cutoff.

## Remaining gates

Use independently held-out visible-face public positives and difficult negatives before selecting a candidate. Keep the rear-facing misses explicit. Measure detection coverage, identity matching, and pair verdicts separately. Phone and Mac agreement is a platform check, not evidence of reliable recognition.

No new app source, native build, library rescan, saved reference, or threshold was deployed by this investigation. The original zero-addition problem remains unresolved.

## Final checks

- Actual installed-phone synthetic check passed; final lossless public-photo check passed. The original JPEG comparison remains a recorded strict failure.
- The cached dlib comparison ran through the actual Vision helper and the shared pair policy. Three unit regressions passed for distinct faces, ambiguity, the strict distance boundary, and invalid scores.
- Full suite passed 2,576 tests in 245 files with two workers, logged in `.expo/crit/ios-recognition-parity-full.log`.
- TypeScript typecheck, scoped ESLint, Python syntax compilation, and whitespace checks passed.
- Live phone cache inspection found zero `aoi-public-parity-*` files, no active public diagnostic, and no retained diagnostic result. No Mac test helper, fixture server, or compilation scratch directory remained. The pre-existing Metro server remains available for the app.
- These checks do not verify reliable personal-library recognition, inaccessible cloud assets, HEIC/HDR parity, false-addition risk on natural negatives, or the commercial SDK candidates.
