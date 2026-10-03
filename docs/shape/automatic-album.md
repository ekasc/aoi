# Automatic album wiring

## Accepted rule

Include photos with both enrolled people present, including group photos. Exclude solo and uncertain matches. Setup is once per phone, not once per photo.

## Execution checklist

- [x] Read operating principles and trace the existing recognition, local-photo, session, and shared-album code.
- [x] Compare implementation shapes: screen-owned scanning loses new-photo events outside Us; an authenticated provider can resume across tabs and cancel on account changes. Use the provider.
- [x] Implement secure enrollment and persisted scan decisions with removal suppression.
- [x] Wire permission-aware foreground/library-change scans and setup into Us.
- [x] Verify tests, runtime model loading, rendered setup, and no-consent behaviour.
- [ ] Shared encrypted sync remains a separate missing subsystem. Do not imply local discoveries are visible to a partner.

## Contracts

`AutomaticAlbumProvider` owns one scoped controller per signed-in user and space. It cancels on background, unmount, disable, and scope changes. Recognition runs serially. Faceprints stay in device-only SecureStore. Selected references now produce small, re-encoded face thumbnails in the scoped app cache; full reference photos and their source URIs are not retained. A persisted asset version index avoids repeating inference and records imported photo IDs so removal suppresses re-addition. Failed reads/inference are retried, not written as non-matches. Foreground/library changes enumerate accessible photos again to catch additions while the app was closed.

The setup sheet uses the existing native sheet and button components. Users choose one solo reference for each identity and explicitly confirm permission to use both faces. The final enable action requests library read permission. Limited access is distinct from full access, denied access has a Settings action, and turning discovery off deletes faceprints without deleting gallery originals or existing album copies.

## Fence

No automatic permission grant, photo selection, enrollment, gallery scan, or upload during agent verification. No simulator, deployment, commit, or account/phone-data reset. Existing Metro stays running. Checks use at most two workers, sequentially.

## Available on the phone

Open Us, then Find photos of us. Confirm permission to use both identities, choose one clear solo reference for each person, then enable discovery and grant photo access. No additional picking is needed for individual album photos. Discovery enumerates accessible photos in pages of 40, imports only pair matches, and catches additions on foreground or photo-library change events. It does not run indefinitely while iOS suspends the app.

The feature is dev-build-only until real-photo accuracy is calibrated. Production keeps the manual-photo flow and does not restore or start automatic scans. Results are device-local, not partner-synced. The UI says this explicitly. The dev preview at `/dev-album` is only for browser verification; the phone uses the real Us screen and authenticated provider tree.

Matched photos use the existing re-encoding, durable-copy, and content-hash deduplication path. Removal writes a persistent content-ID exclusion before deleting the copy. This survives re-enrollment, repeated library assets, and a failed scan-index write after import. Explicit manual re-addition remains possible. Original gallery photos are never deleted.

Faceprints use little-endian float32 encoding in two device-only SecureStore entries, each below 2KB. The enable marker is written last. Reference photo URIs are not persisted by the enrollment code. Turning off waits for in-flight work to settle and deletes faceprints. Scope changes and backgrounding cancel further scan work; an in-flight native call or local copy cannot be interrupted.

Limited permission is reported separately. Revoking/changing access interrupts the scan and rechecks permission. Cloud-only photos are not downloaded as a side-effect of discovery. Unreadable assets and failed inference stay undecided for later retries, rather than being recorded as nonmatches. Group photos can qualify even when an unrelated face cannot be aligned, provided both enrolled identities are confidently matched on two other distinct faces. If failures prevent establishing both identities, the scan remains failed rather than returning a successful nonmatch.

## Verification

- Full suite: 2,491 tests in 230 files passed with at most two workers. Album suite: 218 tests in 19 files passed. Logs: `.expo/crit/automatic-album-full.log`, `.expo/crit/automatic-album-tests.log`.
- Regression assertions cover consent gating, production gating, scope isolation, pair/group versus solo results, unusable extra group faces, failed import/index writes, permanent removal suppression, Retry, pagination, permission denial/limited access, and library listener cleanup. Matching uses the actual cosine matcher; embedding doubles do not claim face-recognition accuracy.
- `pnpm run face:verify:phone` passed against the rebuilt physical iPhone. It writes a generated person-free image into the app cache, calls the actual native decoder, detector, alignment, ONNX inference, and normalization pipeline, compares two embeddings to OpenCV CPU reference outputs, deletes the scratch image, and releases the model session before reporting success. It does not read the gallery or enroll anybody.
- Phone/reference cosine agreement was above 0.999999999 for identity and tilted geometry, with maximum normalized-vector errors below 0.0000016. Native Vision reported zero faces in the synthetic image. Report: `.expo/face-engine-verification/phone-results.json`. Numerical parity is not recognition accuracy.
- App typecheck, scoped ESLint, and `git diff --check` passed. Accessibility audit: 112 files, zero findings. Native capture still reports zero accessibility elements, so VoiceOver remains unverified.
- Agent-browser exercised the actual setup sheet at `/dev-album` with a 390×844 viewport. References and enable are disabled before consent; unsupported web recognition returns an explicit alert without opening a picker or scanning. No gallery fixtures were seeded.
- The physical iPhone build and installation passed with two Xcode build workers. The signed app's photo-permission string now explains optional automatic library access. No app was uninstalled. Logs: `.expo/crit/automatic-album-xcode.log`, `.expo/crit/automatic-album-install.json`, `.expo/crit/automatic-album-launch.json`.
- The real phone Us entry and setup sheet were captured and inspected at `.expo/aoi-debug/screenshots/2026-10-02T06-35-33-288Z-ikq8db.jpg`. Consent remained off. No reference photos were chosen and no library scan or upload ran during verification.

Native scrolling exposed the footer and Done control, and Done returned to the actual Us tab. Captures: `.expo/aoi-debug/screenshots/2026-10-02T06-46-42-404Z-0jx995.jpg` and `.expo/aoi-debug/screenshots/2026-10-02T06-47-22-783Z-kp93pi.jpg`. Browser dismissal was also verified by waiting for the dialog to leave the DOM, then closing the isolated browser session. One combined shell command hit its time limit during a final debug-property check; rerunning that check alone confirmed that the synthetic probe was removed. `git diff --check` passed afterward.

Generated compiler caches from this build were removed after installation to recover disk space. The signed build product and requested Metro session remain. No simulator is booted.

## Not completed

Shared encrypted album storage, device-key verification/recovery, both-partner enablement, and two-device sync are not wired. The phone still uses stub auth. Local discovery is not a shared-album implementation and does not create Memories. Real-photo precision/recall, threshold calibration, profile/small/blurred-face coverage, battery behaviour, and permission/enrollment testing by the actual partners remain required before production or automatic uploads.

## First-scan bug fixes and reference feedback

The reported scan had thousands of failures but still returned `complete`. A regression reproduced that result before the fix. Failed checks now return `partial`; the sheet distinguishes unavailable local files, read errors, detection errors, and embedding errors. Progress includes visited and cached assets plus the accessible photo count. It does not equate that count with videos or inaccessible photos in the system library.

Negative decisions are flushed per page or slice, rather than rewriting a growing full index after every photo. Imported matches still commit immediately. Persistent cursors resume from the last finished asset, including after user pause. The first pacing patch used an eight-second budget, a 100ms pause after uncached work, and 15-second breaks. The user rejected that approach; those fixed waits and the production controller's time budget have now been removed. Individual native calls remain non-interruptible. Single-face photos skip embedding because they cannot satisfy the pair rule.

The native module reports serious/critical thermal state and Low Power Mode so discovery can pause. This native addition requires a rebuilt dev app. iOS suspension still stops discovery; no closed-app background job has been registered. The UI explains the first-check wait and allows other Aoi screens during discovery.

Reference selection exposes preparation, picker, assessment, and embedding phases beside the selected person, with person-specific errors. Small avatars come from 144px face crops. Assessment rejects group/no-face/missing-landmark references and explains small faces or head tilt. Apple Vision capture quality, when available, is a separate comparison score, not identity confidence or a calibrated prediction of matching accuracy. Existing enrolled photos cannot acquire avatars retroactively because their source photos were never retained. They remain usable until the user chooses replacements. Replacement enrollment uses a new reference ID, writes its faceprints before switching the enable marker, and invalidates negative scan decisions while retaining removal suppression.

Checks for this follow-up: 2,505 tests in 233 files passed with `npx vitest run --maxWorkers=2`; the targeted album suite passed 232 tests in 22 files. Typecheck, scoped ESLint, accessibility audit with zero findings, and diff whitespace checks passed. `FacePhoto.swift` typechecked against the iPhoneOS SDK. Agent-browser exercised consent, unsupported-web recognition feedback, and dismissal on `/dev-album`; the isolated browser session was closed. Logs: `.expo/crit/album-bug-full.log` and `.expo/crit/album-bug-suite.log`.

No phone was connected to Metro during this follow-up. The new native functions have not been installed or exercised on the phone. The original zero-match cause, real-photo accuracy, capture-quality usefulness, thumbnail appearance on the phone, thermal behaviour, and VoiceOver still need device verification. No reference selection, library scan, data reset, upload, or threshold change occurred during agent verification.

## Newest-first dating-date range

Discovery now queries PhotoKit for photos from local midnight on the relationship start date onward, in descending creation-date order. The date predicate is passed on every page, before local-file reads or face inference, so older photos do not incur recognition work and the reported total describes the filtered accessible set. Expo's native query uses a strict greater-than predicate; the request subtracts one millisecond to include the start-day midnight boundary. Missing dates block discovery with a link to relationship settings instead of silently scanning the whole library.

Changing the date restarts pagination and cancels the old controller. The range is part of the checkpoint identity, but not the face-decision identity, so unchanged photos retain their cached results. Explicit pause/resume still uses the saved cursor. The 100ms per-photo timer, 15-second continuation timer, and eight-second forced slice are removed. Actual thermal/Low Power Mode checks remain. Matching thresholds, five-point alignment, and two-distinct-face requirements are unchanged.

This removes artificial waits and avoids processing pre-relationship photos; it does not establish recognition accuracy or a measured phone scan time. The researched iOS 26 continued-processing integration is still unimplemented, so switching to another app still pauses this build's controller. No gallery scan was started during verification.

Verification: targeted album tests passed 237 tests in 22 files; the full suite passed 2,510 tests in 233 files with `npx vitest run --maxWorkers=2`. Typecheck, scoped ESLint, accessibility audit with zero findings, and `git diff --check` passed. Regressions cover continued scanning past eight seconds, dating-date forwarding on every page, inclusive midnight query construction, changed-range cursor invalidation with cached decision reuse, missing-date blocking and its settings action, and existing pause/resume persistence. Agent-browser exercised the real `/dev-album` sheet, confirmed the newest-first date-range disclosure and disabled controls before consent, dismissed the sheet, and closed the isolated session. Logs: `.expo/crit/album-date-range-tests.log`, `.expo/crit/album-date-range-full.log`. Native PhotoKit filtering and real-photo accuracy were not exercised on a phone.
