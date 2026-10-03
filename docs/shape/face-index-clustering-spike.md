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

`identify.ts` takes several enrollment embeddings per person and attaches every
cluster with consistent evidence. A person is a *set* of clusters, not one
cluster: forcing one person to one cluster drops every face in a fragment.

Scoring has two forms. Centroid-based (`max`, `mean`, `median`, `trimmed-mean`,
`majority-vote`) scores one similarity per reference against the cluster mean.
Member-based (`member-support`, `top-k`, `representative`) scores against cluster
members. `member-support` takes the best member, `top-k` averages the best three,
and `representative` takes the best of up to five members closest to the
centroid. Member-based scoring survives fragmentation, but `member-support`
gives a large cluster more chances to hold one unusually close member.

Support has two forms. Vote-based (`majority-vote`) counts, per reference, which
cluster that reference matches best, and support is the share that picked this
one. Threshold-based (every other strategy) is the share of references whose
score for this cluster clears `memberSupportFloor`.

A cluster attaches when its aggregate score clears `identificationFloor`, its
support clears `supportFloor`, and it is within `attachmentMargin` of that
person's best cluster. A cluster claimed by both people attaches to neither. A
person with a single reference has no cross-reference evidence, so only the
strongest cluster attaches and the rest report
`single-reference-attach-limit`.

Identification is one-shot: it maps clusters, it never pulls faces into them, so
a weak match cannot poison a cluster. `identifyPartnerClustersWithEvidence`
returns the same identification plus per-cluster evidence: A and B aggregate,
support, per-reference scores, `attachedTo`, `sharedClaim`, and a reason. The
evaluator writes that evidence into the report, so a face can be traced from its
cluster to why the cluster belongs to A or B. No embeddings are emitted.

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

## Phase 6b — the real-photo evaluator

`pnpm run face:evaluate:labelled -- --dataset <folder>` runs the same real Vision
+ SFace pipeline over a folder the user supplies:

```
references/   a.jpg, or a-1.jpg, a-2.jpg, ...; b.jpg, or b-1.jpg, b-2.jpg, ...
positive/     both people visibly present
solo-a/       only partner A
solo-b/       only partner B
negative/     neither person
groups/       group photos with zero or one enrolled person
```

The label is the enclosing folder name; file names never imply a label. The
report separates detector, alignment, and embedding failures from identity miss,
cluster fragmentation, ambiguous identity, correct pair, and false pair. It
reports positive recall and a false-pair rate for each of solo-A, solo-B,
negative, and groups, with the sample size beside every rate. It compares the
baseline, cluster-first at the current conservative settings, a cluster-threshold
sweep, and all eight identity strategies. Each strategy reports positive recall,
false-pair additions, identity ambiguity, clusters attached to A, clusters
attached to B, and shared or contested clusters.

The report keeps the absolute dataset root out of every field. It stores relative
file names, category, aggregate counts, and model or configuration details only.
It also stores `clusterEvidence` and per-face diagnostics, so each face traces
from its cluster to why the cluster belongs to A or B to the pair decision. The
report stays local and contains no image bytes, crops, embeddings, or absolute
path.

`--corpus all` indexes every photo, the shape production would take.
`--corpus references` clusters only the reference faces so query photos are held
out. The report is written under `.expo/face-lab/` and stays local; it contains
relative file names for debugging and no image bytes, crops, or embeddings.

No real labelled dataset exists in this repo, so this path has not been run on
real couple photos. It was smoke-tested end to end on the committed public
synthetic images to prove the plumbing, then those files were removed. The
synthetic strategy comparison below is the only labelled evidence available.

## Results (HyperFace subset, synthetic)

16 synthetic identities × 8 portraits; 8 pair cases. Detection and embedding were
perfect on this set: 856 faces detected, 856 embedded, 0 failures; 128/128
identity portraits and 728/728 mosaic faces.

Held-out split, cluster threshold `0.55`, `member-support`:

| Configuration | Positive photos found | Solo-A wrong | Solo-B wrong | Negative/group wrong |
| --- | ---: | ---: | ---: | ---: |
| Current fixed reference, `0.72` | 8 / 64 | 0 / 32 | 0 / 32 | 0 / 96 |
| Cluster-first, one reference | 50 / 64 | 0 / 32 | 0 / 32 | 0 / 96 |
| Cluster-first, four references | 58 / 64 | 0 / 32 | 0 / 32 | 0 / 96 |

Indexed (production-shaped) split, same settings: baseline 13/112, cluster-first
one reference 94/112, cluster-first four references 106/112, with zero false
additions on 56 solos and 168 negatives per person category.

Clustering quality: purity 1.0 and pairwise precision 1.0 in both modes (no two
identities were merged); pairwise recall 0.94 (indexed) and 0.92 (held-out),
i.e. some identities split into fragments. Partner-cluster identification found
8 of 8 cases correctly and 0 incorrectly.

The multi-cluster attachment fixed the earlier regression where four references
performed worse than one: 58/64 against 50/64 held-out, and identification
ambiguity fell from one case to none. Attaching the fragment as well as the main
cluster, instead of forcing one person to one cluster, is what did it.

Exploratory threshold sweep on the held-out split (`member-support`, no threshold
selected):

| Cluster threshold | Clusters | Positive found | False additions |
| ---: | ---: | ---: | ---: |
| 0.40 | 16 | 62 / 64 | 0 |
| 0.50 | 18 | 60 / 64 | 0 |
| 0.55 | 19 | 58 / 64 | 0 |
| 0.65 | 29 | 45 / 64 | 0 |
| 0.75 | 48 | 18 / 64 | 0 |

Identity-strategy comparison at cluster threshold `0.55` on the held-out split
(attached counts are summed over the eight pair cases):

| Strategy | Cases identified correctly | Positive found | False additions | Attached A | Attached B | Shared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `max` | 8 / 8 | 58 / 64 | 0 | 8 | 10 | 0 |
| `mean` | 8 / 8 | 58 / 64 | 0 | 8 | 10 | 0 |
| `median` | 8 / 8 | 58 / 64 | 0 | 8 | 8 | 0 |
| `trimmed-mean` | 8 / 8 | 58 / 64 | 0 | 8 | 8 | 0 |
| `majority-vote` | 8 / 8 | 58 / 64 | 0 | 8 | 8 | 0 |
| `member-support` | 8 / 8 | 58 / 64 | 0 | 8 | 9 | 0 |
| `top-k` | 8 / 8 | 58 / 64 | 0 | 8 | 10 | 0 |
| `representative` | 8 / 8 | 58 / 64 | 0 | 8 | 9 | 0 |

All eight tie on pair recall and false additions on this dataset. The attachment
counts differ by one or two clusters, which is the fragmentation recovered or
missed. The aggregate function stops mattering for this fragmentation pattern
once several clusters attach under a support floor. The strategies differ in the
unit tests, where `majority-vote` drops a fragment only
one reference matches and `member-support` keeps it. Choosing between them needs
real photos with harder fragments.

Full report: `.expo/face-lab/face-index-report-<timestamp>.json` (gitignored).

## Large-cluster member bias

The concern was that `member-support` scores a reference against the single best
member, so a larger cluster gets more chances to hold one unusually close member.
That is reproducible. The unit test builds a correct cluster of three members
consistently similar to the reference and a wrong cluster of eleven members
where only one member is close and ten are unrelated. Under `member-support` the
wrong cluster scores higher and, with two references, both attach to A. Under
`top-k` and `representative` the outlier is diluted or excluded, the wrong
cluster falls below the floor, and only the correct cluster attaches.

This is a unit-test result on constructed vectors, not a measured real-photo
failure. The synthetic benchmark does not exercise it: its clusters are pure, so
no wrong cluster contains a high-scoring outlier. `top-k` and `representative`
are therefore the safer experimental candidates for real photos. The default
stays `member-support` until real data can separate them, and that choice is
flagged as provisional.

## One-reference enrollment

With one reference, threshold support is binary, so it cannot gate anything, and
`attachmentMargin` alone would attach lookalikes. The spike now attaches only the
strongest cluster per person when a person has fewer than two references, and
reports `single-reference-attach-limit` for the rest. The unit test covers one
reference with a true cluster and a nearby plausible fragment. Multi-reference
enrollment keeps multi-cluster attachment because cross-reference support is what
justifies a fragment.

## What the evidence says

On this synthetic dataset, cluster-first substantially outperforms the
fixed-reference matcher: roughly seven times the positive recall at zero observed
false additions. That is the answer to the acceptance question, with the caveats
below.

Failure categories seen, in order of size:

1. **Cluster fragmentation** — some identities split into clusters, and a query
   face in a fragment that never attached is missed. Purity is perfect; recall is
   not. Attaching fragments (multi-cluster) recovered most of this, and the
   remaining 6/64 held-out misses are fragments the support floor rejected.
2. **No detection or embedding failures** on this set, so it says nothing about
   real-world small, blurred, or profile faces.
3. **The strategy choice is not empirically differentiated.** All eight tie here.
   The multi-cluster attachment is what fixed the earlier multi-reference
   regression, not the aggregate function. The member-support size bias is a
   constructed unit-test failure, not one this dataset shows.

## Decisions that changed the work

- **Prove-it-works**: the first evaluator run reported 0 positives and 224
  negatives. The cause was a real bug — the benchmark parser drops `photo.kind`,
  so every photo was counted as a negative. The numbers were discarded and the
  run repeated after reading `kind` from the raw manifest. The first result was
  not rationalised.
- **Test rather than abstract**: query faces use a read-only `classify` against
  the corpus instead of being assigned into it, which keeps the clustering
  quality metric honest and avoids an extra layer.
- **Redesign from first principles**: the identity model was rebuilt around
  "a person is a set of clusters" instead of patching `max` scoring. That is
  what turned the four-reference regression into a gain.

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

- No real labelled dataset exists, so no real couple photo has been evaluated.
  The synthetic results are architecture evidence, not real-world accuracy.
- Synthetic portraits and artificial mosaics, not natural couple photos.
- The held-out split shares one generator and one model; it is not independent
  validation data.
- The quality score is a face-size heuristic, not a calibrated capture-quality
  model, so the low-quality merge path is barely exercised here.
- Zero false additions on 96 negatives is not a safety proof. The negative
  sample is small and synthetic; a real run needs a large, deliberately hard
  negative set before anyone calls it safe.
- The default strategy is `member-support`, which a constructed unit test shows
  can prefer a large wrong cluster that holds one close outlier. `top-k` and
  `representative` do not, and are the safer candidates for real photos. No
  labelled data yet separates them.
- With one reference per person, only the strongest cluster attaches. Whether
  that is too strict for real fragments is untested.
- Mac Vision and CPU inference are not an iPhone parity check.
- No production threshold was selected, and no production code reads the spike.

## Verification

- `npx vitest run tests/unit/face-index` — 55 tests across 7 files.
- `pnpm run typecheck` passes; ESLint is clean on `features/face-index/` and
  `tests/unit/face-index/`.
- `pnpm run face:index:evaluate` ran the real native pipeline and the
  identity-strategy comparison; log at `.expo/crit/face-index-strategy-eval.log`.
- `pnpm run face:evaluate:labelled` was smoke-tested end to end on the committed
  public synthetic images (both `--corpus all` and `--corpus references`), then
  the temporary folder and its reports were removed. Logs at
  `.expo/crit/labelled-smoke.log` and `.expo/crit/labelled-smoke-references.log`.
  The smoke report was checked for `clusterEvidence`, for per-face cluster
  reasons, and for the absence of any `/Users/` absolute path.
- No app UX, production threshold, backend API, upload, or enrollment was
  changed. The spike is not imported by any app screen.
