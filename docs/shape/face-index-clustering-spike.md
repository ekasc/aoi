# Face index and clustering spike

Status: experimental. Not wired into the app. Delete `features/face-index/`,
`tests/unit/face-index/`, and `scripts/evaluate-face-index.mjs` to remove it.

## Question

The automatic album compared every detected face against one fixed enrollment
embedding per person. A 1,893-photo scan added nothing. This spike asks whether
indexing every detected face and clustering the embeddings into anonymous
identities finds couple photos better than that fixed-reference matcher.

## Phase 1 — the current pipeline, end to end

Trace of the code that ran the scan. The point of this section is to name the
exact places the architecture commits to a single reference vector.

1. **Detection** — `modules/aoi-face-detector/ios/FacePhoto.swift`. Apple
   Vision's landmark request runs first; when it finds fewer than two faces and
   rectangle revision 3 exists, that detector runs and its boxes get a landmark
   request. Overlapping boxes are deduplicated. Output is a box, a roll angle,
   and 76-point contour regions. There is no detector confidence value.
2. **Landmark generation** — `features/album/face-landmarks.ts`. The five
   alignment points are *estimated* from contours: eye centroids, the nose
   crest point furthest along the eye-to-eye normal, and the extreme outer-lip
   points along and across that axis. The function returns `null` when the
   geometry is impossible. This is not a detector's native five-point output,
   and its agreement with the SFace convention is unverified on real faces.
3. **Alignment** — `features/album/face-alignment.ts` fits an
   orientation-preserving least-squares similarity transform to OpenCV's
   112×112 five-point template; `FacePhoto.swift` warps with OpenCV's
   interpolation convention and black borders.
4. **Embedding** — `features/album/face-recognition-engine.ts` runs the pinned
   SFace ONNX model (128-d) and L2-normalizes the output in
   `normalizeFaceEmbedding`. Query-side flip fusion exists but is off by
   default. Model identity is
   `sha256:vision-contours-v1:aligned-rgb112-v1`.
5. **Identity comparison** — `features/album/face-pipeline.ts`, `matchByCosine`:
   the best cosine over the enrolled prints, and `unsure` below the threshold.
6. **Pair classification** — `matchPairByScores`. Each face is scored against
   both people; it must clear the threshold for exactly one, and two *distinct*
   faces must establish the two people. A face that crosses the threshold for
   both establishes neither.
7. **Cache and index** — `features/album/automatic-album.ts`,
   `automatic-album-storage.ts`. There is no face index. Each photo is detected
   and embedded again, then compared to the two stored references. Decisions are
   persisted per asset under a version string that includes the model id, the
   `referenceId`, the cutoff, and the detector policy. Faceprints live in
   device-only SecureStore: exactly two entries, `you` and `partner`.

### Where it assumes one fixed representation

- `Faceprint` is a single embedding; `AlbumEnrollment.prints` is exactly
  `[you, partner]`; `enrollSoloFace` rejects anything but one face in the
  reference photo.
- Storage keys are literally `.you` and `.partner` — one vector each.
- `matchByCosine` reduces identity to the maximum cosine against those vectors.
- The version prefix contains `referenceId`, so replacing a reference
  invalidates every negative decision. There is no accumulated representation to
  invalidate — the identity *is* the one vector.

### Where pair classification depends on the hard cutoff

- `matchPairByScores` is a pure threshold comparison (`>= threshold`) on one
  embedding-versus-reference cosine per person, with `DEFAULT_MATCH_THRESHOLD =
  0.72`. There is no cluster, no per-identity distribution, and no second
  observation that could outvote one bad match.

### Diagnostics that exist, and what is missing

Existing: `ScanProgress` counters (`noFaces`, `singleFace`, `uncertain`,
`detectionFailures`, `embeddingFailures`, `unavailableFiles`),
`diagnosePhotoFaces` (per-photo geometry only), the offline
`evaluate-pair-scores.mjs` tool, and the native parity runners.

Missing, and why the `0 / ~1,893` result cannot be explained from what is
stored: the scan records that 153 photos were `uncertain` but not the scores
that made them uncertain, and no per-face embedding survives the scan. So there
is no way to tell a reference that does not generalise from a library that
genuinely contains no qualifying photo. The audit's own note is explicit: "The
cause of the 153 rejected candidates remains unresolved."

## Phase 2 — the local face index

`features/face-index/` is a plain TypeScript spike with no React Native or Expo
imports, so it runs under vitest and the Mac evaluator unchanged.

- `types.ts` — `IndexedFace` (one asset may hold many faces), anonymous
  `FaceCluster`, `ClusterAssignment`.
- `embedding.ts` — `normalizeEmbedding` / `createIndexedFace`. Rejects wrong
  dimensions, non-`Float32Array` input, NaN, Infinity, and zero/near-zero
  vectors. Returns `null`; one malformed detector output cannot abort a scan.
- `face-index.ts` — in-memory index scoped to a model id. `resetForModel` clears
  the whole index when the recognition model changes, because two models'
  vectors are not in the same space.

No persistence in this spike. `modelId` is the key a future store must partition
on; storing embeddings is deliberately deferred.

## Phase 3 — clustering

`clusterer.ts` is incremental nearest-neighbour clustering over normalized
embeddings:

- one face joins the most similar cluster or starts a new one;
- faces below `qualityFloor` must clear `lowQualityThreshold` (stricter);
- faces are processed in sorted id order, so the same input produces the same
  clusters;
- `reject(faceId, clusterId)` detaches the face and is remembered, so it cannot
  immediately rejoin that cluster;
- `classify` is a read-only nearest-cluster lookup for query faces that must not
  mutate the corpus.

The defaults (`0.55 / 0.72 / 0.5`) are uncalibrated spike placeholders. The
clustering API never mentions "you", "partner", or any person. It produces
`cluster-0`, `cluster-1`, … only.

## Phase 4 — seeding the two people

`identify.ts` takes several enrollment embeddings per person and scores every
anonymous cluster by the maximum cosine from any enrollment print to the cluster
centroid. It accepts a mapping only when each person's best cluster is distinct,
above `identificationFloor`, and separated from the runner-up by `marginFloor`.
Identification is one-shot: it maps clusters, it never pulls faces into them, so
a weak match cannot poison a cluster. Expansion of an identified cluster is
explicitly out of scope for this spike.

## Phase 5 — the couple-photo query

`pair-query.ts` returns a diagnostic per asset: every detected face, its cluster,
its person, and why the asset qualified. An asset qualifies when one face
belongs to A and a different face belongs to B. Group photos qualify. One face
has one cluster and one cluster has one person, so an ambiguous face can never
count as both.

## Phase 6 — the evaluator

`pnpm run face:index:evaluate` (optionally `--benchmark <dir>`) reuses the same
Apple Vision detector, alignment, and SFace model as the app, over the existing
HyperFace subset. It reports detection, embedding, clustering, partner
identification, pair recall, and false additions separately, and never collapses
them into one number. It writes aggregate counts only — no photos, crops,
embeddings, source URIs, or identity labels.

Two modes are reported:

- **indexed** — every portrait is clustered; query photos are cluster members.
  This is the shape production would take.
- **held-out** — the corpus is portraits 0–3 only, and the query mosaics are
  built from portraits 4–7, which were never indexed. This is the fair
  generalisation test and the one that answers the question.

The baseline is the current fixed-reference matcher on the *same* detected faces
and embeddings, at the unchanged `0.72`.

## Results (HyperFace subset, synthetic)

16 synthetic identities × 8 portraits; 8 pair cases. Detection and embedding were
perfect on this set: 856 faces detected, 856 embedded, 0 failures; 128/128
identity portraits and 728/728 mosaic faces.

Held-out split, cluster threshold `0.55`, identification floor `0.5`:

| Configuration | Positive photos found | Solo-A wrong | Solo-B wrong | Negative/group wrong |
| --- | ---: | ---: | ---: | ---: |
| Current fixed reference, `0.72` | 8 / 64 | 0 / 32 | 0 / 32 | 0 / 96 |
| Cluster-first, one reference | 50 / 64 | 0 / 32 | 0 / 32 | 0 / 96 |
| Cluster-first, four references | 44 / 64 | 0 / 32 | 0 / 32 | 0 / 96 |

Clustering quality: purity 1.0 and pairwise precision 1.0 in both modes (no two
identities were merged); pairwise recall 0.94 (indexed) and 0.92 (held-out),
i.e. some identities split into fragments. Partner-cluster identification found
7 of 8 cases correctly and 0 incorrectly; one case was ambiguous
("Two clusters are too close to assign confidently").

Exploratory threshold sweep on the held-out split (no threshold selected):

| Cluster threshold | Clusters | Positive found | False additions |
| ---: | ---: | ---: | ---: |
| 0.40 | 16 | 62 / 64 | 0 |
| 0.50 | 18 | 45 / 64 | 0 |
| 0.55 | 19 | 44 / 64 | 0 |
| 0.65 | 29 | 8 / 64 | 0 |
| 0.75 | 48 | 0 / 64 | 0 |

Full report: `.expo/face-lab/face-index-report-<timestamp>.json` (gitignored).

## What the evidence says

On this dataset, cluster-first substantially outperforms the fixed-reference
matcher: roughly six times the positive recall at zero observed false additions.
That is the answer to the acceptance question, with the caveats below.

Failure categories seen, in order of size:

1. **Partner-identification ambiguity** — one of eight cases could not be
   resolved, which removes up to eight positives by itself. The cause is two
   clusters scoring within the margin floor.
2. **Cluster fragmentation** — some identities split into two clusters, so a
   query face can land in the fragment the enrollment key did not select.
   Purity is perfect; recall is not.
3. **More references made it worse, not better** — four references found 44/64
   against 50/64 for one. With `max`-over-references scoring, a reference inside
   a small fragment can pull the chosen cluster away from the main one. Multi-
   reference enrollment needs a rule that does not reward fragments before it
   can be called an improvement.
4. **No detection or embedding failures** on this set, so it says nothing about
   real-world small, blurred, or profile faces.

## Decisions that changed the work

- **Prove-it-works**: the first evaluator run reported 0 positives and 224
  negatives. The cause was a real bug — the benchmark parser drops `photo.kind`,
  so every photo was counted as a negative. The numbers were discarded and the
  run repeated after reading `kind` from the raw manifest. The first result was
  not rationalised.
- **Test rather than abstract**: query faces use a read-only `classify` against
  the corpus instead of being assigned into it, which keeps the clustering
  quality metric honest and avoids an extra layer.

## Licensing and model strategy

SFace remains the recogniser because its model directory is Apache-2.0 and its
weights are already pinned and parity-checked. Ente's architecture is the
reference for the shape — detector with five landmarks, normalized embeddings,
incremental clustering, multiple observations per identity, local clusters — but
no Ente code or AGPL source was copied. InsightFace recognition weights and
other checkpoints without checkpoint-specific commercial permission were not
downloaded or used.

A modern commercially licensed on-device recogniser is worth testing later, but
only after checkpoint-specific commercial rights and offline deployment terms are
documented. This spike needed the smallest architecture that could produce a
meaningful comparison, and SFace provided it.

## Limitations

- Synthetic portraits and artificial mosaics, not natural couple photos.
- The held-out split shares one generator and one model; it is not independent
  validation data.
- The quality score is a face-size heuristic, not a calibrated capture-quality
  model, so the low-quality merge path is barely exercised here.
- Zero false additions on 96 negatives is not a safety proof.
- Mac Vision and CPU inference are not an iPhone parity check.
- No production threshold was selected, and no production code reads the spike.

## Verification

- `npx vitest run tests/unit/face-index` — 32 tests across 6 files.
- `pnpm run typecheck` passes; ESLint is clean on `features/face-index/` and
  `tests/unit/face-index/`.
- `pnpm run face:index:evaluate` ran the real native pipeline; log at
  `.expo/crit/face-index-eval.log`.
- No app UX, production threshold, backend API, upload, or enrollment was
  changed. The spike is not imported by any app screen.
