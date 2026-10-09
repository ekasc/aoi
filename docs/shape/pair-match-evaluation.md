# Pair-matching evaluation

The current cutoff of 0.72 is uncalibrated. Do not lower it from a single missed photo or treat successful face detection as evidence of identity recognition.

## Verified engineering behaviour

- Pair matching and the offline evaluator use the same `matchPairByScores` function. It requires two distinct faces that each qualify for only one enrolled reference. Group photos remain eligible; ambiguous faces cannot establish either reference.
- Scan decision and pagination-checkpoint versions include the policy version and cutoff. Changing the cutoff rechecks old negative decisions instead of silently reusing them. Existing imports and removal exclusions stay suppressed.
- A regression exercises a synthetic pair below an initial cutoff, changes the cutoff, and verifies that the real scanner and sky repository produce a durable copy. It also verifies that later policy changes do not resurrect an already imported photo.
- Pinned weights and license checks passed. The native/OpenCV synthetic engine check passed all eight EXIF orientations, pixel preparation, model integrity, and four alignment cases. This proves preprocessing parity on those fixtures, not real-photo recognition accuracy.

## Offline score evaluation

Run:

```sh
node --experimental-strip-types scripts/evaluate-pair-scores.mjs path/to/scores.json
```

The input contains anonymized numerical scores, not images, image paths, face embeddings, or names. See `tests/fixtures/album/synthetic-pair-scores.json` for the schema. Its numbers are invented and must never be used to select the app's real cutoff.

Each sample has a split, an anonymous group, a ground-truth `bothPresent` boolean, and a score for each detected face against each reference. Keep related photos and reference groups in one split to avoid leakage. Both calibration and held-out validation need positive and negative samples. Include solo photos, unrelated pairs, group photos missing one partner, and ambiguous matches. A useful real evaluation also covers lighting, pose, age, glasses, small faces, and different capture devices. Collect any such dataset through an authorized evaluation process; this tool neither collects photos nor compares identities.

The tool reports the current cutoff's misses and false positives. It selects a candidate from calibration samples only, maximizing accepted positives under zero observed calibration false positives. Ties choose the higher cutoff. Held-out validation is evaluated once and never used to retune that candidate. A validation false positive remains visible rather than being optimized away.

Zero observed false positives is not proof of safety. The report includes a one-sided 95% bound based on independent negative groups. With only two negative groups, zero errors still leaves an upper bound above 77%. The tool always reports `readyForProduction: false` and never changes app configuration. Dataset coverage and independence still require human review.

## Open finding

The phone scan visited 1,893 photos: 1,487 analyzed, 70 cached, 301 unavailable local files, 13 detection failures and 22 embedding failures. Analyzed results were 897 no-face, 437 single-face and 153 uncertain. Zero additions is therefore an incomplete result, not a demonstrated absence of matching photos.

The selected phone photo passed native detection and five-point alignment availability. No real-photo identity comparison or real cutoff calibration was performed in this audit. The cause of the 153 rejected candidates remains unresolved. The app cutoff stays at 0.72, and production automatic discovery remains gated.

## Checks

- The new scanner regression failed before the cutoff was threaded through matching and cache versioning, then passed after the fix.
- The CLI was executed against the committed synthetic fixture. The candidate and held-out metrics were produced by the shared app policy, not a mocked evaluator. Tests also exercise validation false positives, group leakage, missing negative samples, invalid scores, and forbidden photo paths.
- The album suite passed 248 tests across 24 files. The full suite passed 2,525 tests across 235 files with two workers, logged at `.expo/crit/pair-match-evaluation-full.log`.
- Typecheck, scoped ESLint, accessibility audit with zero findings, and whitespace checks passed.
- No live library rescan, threshold change, new reference selection, upload, commit or push was performed in this phase.

## Current photo-check flow

The evaluation panel was removed from the setup sheet after feedback that it made the task too complex. The app no longer asks users for calibration splits, session labels, dataset labels, or exports. Subtract-before-add changed the design: the full-screen check prepares crops only, without running identity comparisons or collecting evaluation samples.

Find photos of us now has one Check this photo action. It closes the setup sheet before navigating to `/album/check-photo`. The page asks for one photo containing both people, shows aligned crops, and asks whether the faces are upright and complete. It distinguishes no faces, one face, missing crops, unreadable photos, cancellation, and processing. Discovery stays paused after the check; the existing Resume discovery action remains explicit. Leaving the route cancels pending work and clears previews. The route and action remain dev-only. Original photos, enrollment, imported copies, and the cutoff are unchanged.

The technical calibration UI and its preview route have been deleted. Offline score-evaluation tooling remains for engineering work. A new `/dev-photo-check` preview exercises the shared full-screen component without selecting personal photos or mutating real app data.

Verification: 2,542 tests passed across 239 files with two workers, logged at `.expo/crit/simple-photo-check-full.log`. Typecheck, scoped ESLint, static accessibility audit with zero findings, and whitespace checks passed. Browser interaction covered selecting a synthetic two-face example, missing-crop feedback, no-face results, and unreadable-photo alerts. The browser session was closed. The phone was connected, but its running navigator did not include the new route, so native sheet-to-page transitions and actual crop display remain unverified. No personal photo was selected and the phone was not reloaded to force a new scan.

## Historical on-device evaluation tools, removed from the app UI

In the dev build, open Find photos of us, then Open local evaluation. Select Calibration or Validation, use an anonymous capture-session label, and choose whether a selected photo contains both people, one, or neither. Selection pauses discovery and evaluates only that selected file. It does not import a sky copy or change enrollment or the cutoff. Cancellation stops between native operations. Failed detection or embedding checks remain separate from successful rejections.

The latest photo shows up to eight aligned 112 × 112 crops. Preview generation calls the existing native `prepareFace` function with the same landmark transform as the inference pipeline, then converts planar RGB to opaque RGBA and encodes a PNG in memory. It does not perform a separate approximate rectangular crop. Skia buffers are released, temporary embeddings are zeroed, and the images disable disk/memory caching. Closing the setup sheet or hiding evaluation clears the current previews. Clearing samples, changing saved references, disabling discovery, or unmounting the scoped provider clears the evaluation session.

Samples are kept in memory. Library asset IDs are used only for local duplicate suppression when provided by Photos; they are never exported. Users still need different capture sessions for held-out validation, and duplicate detection is not guaranteed when Photos omits an asset ID. The runner blocks an entered capture-session label from crossing splits.

Copy anonymized results produces the score-only JSON accepted by the offline CLI. Exports include model and policy provenance, the current cutoff, failed-photo count, binary labels, and scores. They exclude photos, crops, embeddings, source URIs, asset IDs, names, and the entered session labels. Session labels are replaced with anonymous group numbers while preserving grouping. No upload occurs. Comparison across models uses separate provenance-tagged exports; no second model has been added.

The development route `/dev-album-evaluation` exercises the actual panel with explicitly synthetic examples on web. It is production-gated and does not seed the real app or phone. Browser checks covered the empty state, both split selectors, positive/negative labels, group leakage feedback, and clearing crops and samples. Screenshot: `/Users/ekassinghchhabra/.agent-browser/tmp/screenshots/screenshot-1790987756443.png`.

The album suite passed 260 tests across 27 files. The full suite passed 2,537 tests across 238 files with two workers, logged at `.expo/crit/album-local-evaluation-full.log`. Typecheck, scoped ESLint, accessibility audit with zero findings, and whitespace checks passed. Adapter tests assert native transform arguments, 112px layout, channel order, buffer disposal on success and failure, cancellation, privacy-preserving export, and CLI compatibility.

The physical phone was disconnected during this implementation. Actual native crop rendering, the native picker interaction, screen-reader behaviour, and real recognition accuracy remain unverified. The existing native `prepareFace` and Skia dependencies are reused; no native build or simulator was started. No real photo was selected, no library rescan was initiated, and no cutoff was changed during agent verification.
