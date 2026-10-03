# Real-photo face-index evaluation

Status: not run. No private labelled dataset exists in this workspace yet, so no
real-photo result has been produced. This file records the acceptance test, the
privacy rules, and the tooling. Do not fill in numbers until a real dataset is
run.

## Acceptance question

Does cluster-first recognition recover substantially more real couple photos
than the current fixed-reference matcher while keeping false pair
classifications acceptably low?

`top-k` is the primary candidate because `member-support` has a constructed
large-cluster outlier bias (see the spike note). This pass does not change
production behavior.

## Workspace

The private dataset lives at:

```text
.expo/face-lab/private-eval/
  references/
  positive/
  solo-a/
  solo-b/
  negative/
  groups/
```

The whole `.expo/` tree is gitignored. Nothing under it is tracked, committed,
or uploaded. The evaluator report also lands under `.expo/face-lab/` and stays
local. It stores relative file names, category, aggregate counts, and the
cluster evidence scores, but no absolute dataset path, image bytes, crops, or
embeddings.

Import photos with:

```sh
pnpm run face:evaluate:import -- --status
pnpm run face:evaluate:import -- --category positive --source ~/Desktop/couple-pics
pnpm run face:evaluate:import -- --category references-a --source a1.jpg --source a2.jpg
```

The importer reads only the paths you pass. It does not scan the Photos library,
it refuses a source that lives inside the dataset root, it leaves originals
untouched, and it rejects unsupported files. Names are anonymized to a content
hash by default, so the local report does not carry original file names. Use
`--keep-names` to keep a readable base name plus a short hash. Use `--dry-run`
to see the plan before writing.

## Dataset quality

Minimums for a meaningful run:

| Category | Minimum |
| --- | ---: |
| positive | 50 |
| solo-a | 30 |
| solo-b | 30 |
| negative | 75 |
| groups | 50 |

More is better, especially negatives. Do not pad with trivial negatives to
improve the false-positive rate. The positive set should include normal selfies,
rear-camera photos, group photos with both partners, side angles, poor lighting,
glasses, hairstyle changes, distance, partial occlusion, older photos, and
screenshots or messaging-app copies. The negative and group sets should include
friends, family, siblings if available, recurring people, similar-looking
people, crowds, screenshots containing faces, and photos of photos.

## Enrollment references

Use three to five real references per person, covering front, slight left and
right, different lighting, and different appearance where useful. References
must be separate from the evaluation set. Do not use a positive image as a
reference. Reference files are named `references/a-*` and `references/b-*` by
the importer.

## Run

```sh
pnpm run face:evaluate:labelled -- --dataset .expo/face-lab/private-eval --strategy top-k --corpus references
pnpm run face:evaluate:labelled -- --dataset .expo/face-lab/private-eval --strategy top-k --corpus all
```

Run both corpus modes. Do not change thresholds before seeing the results. The
evaluator already runs the strategy comparison and the threshold sweep, so keep
those outputs.

`--corpus all` indexes every photo, the shape production would take.
`--corpus references` clusters only the reference faces, so query photos are
held out. A real gain should show in both.

## What to compare

For every configuration, give raw counts and rates:

1. Baseline fixed-reference matcher at production `0.72`.
2. Cluster-first `top-k` at the current spike settings.
3. All eight identity strategies on the same dataset.
4. The existing threshold sweep, as evidence only. Do not select a production
   threshold from it.

## Missed-positive analysis

For each positive that cluster-first misses, classify the cause from the actual
diagnostics, not from a guess:

```text
detector miss
only one face detected
alignment failure
embedding failure
below cluster threshold
unattached fragment
identity ambiguity
identity assignment error
pair-query error
other / unresolved
```

Group the result by cause. The point is to name the stage that limits recall.

## False-pair analysis

Every false pair is high priority. For each one, report category, number of
detected faces, the face to cluster assignments, and for the offending cluster:
A and B aggregate, support, per-reference scores, cluster size, and attachment
reason. Include the strategy and cluster threshold, and why the pair query
accepted it. Do not print raw embeddings.

Classify each false pair as wrong cluster merge, wrong identity attachment,
lookalike, scoring issue, bad enrollment reference, query classification, or
other.

## Cluster-size concern

On the real dataset, compare false attachments against cluster size for
`member-support`, `top-k`, `representative`, and `majority-vote`. Report whether
larger clusters are disproportionately attached incorrectly. If `top-k` or
`representative` performs worse on real data, report it plainly. Do not keep
`top-k` as the preferred strategy because it was expected to be safer.

## Acceptance criteria

The spike passes only if the real data shows all of:

1. Cluster-first materially improves positive recall over the fixed reference.
2. False pair classifications stay very low.
3. The improvement survives difficult negatives.
4. Failures are explainable from the evidence chain.
5. Results do not depend on one overfit threshold.

No numeric bar is fixed in advance. If false pairs appear, understand them
before chasing recall.

## Model swaps

Do not replace SFace, Apple Vision, or the landmark pipeline in this pass. If
detection, alignment, or embedding turns out to be the dominant bottleneck,
document that as the next experiment. One controlled variable at a time.

## Results

Not run. No private dataset was available, and synthetic data is not a
substitute. When the dataset is populated and the commands above run, record
here, in aggregate and without private filenames or identifiable descriptions:

- dataset sizes per category
- baseline results
- `top-k` results
- all-strategy comparison
- threshold sweep
- false pairs
- missed-positive breakdown
- detection, alignment, and embedding failure counts
- whether cluster size correlates with bad attachments
- whether the evidence supports continuing toward production
- the single next bottleneck
