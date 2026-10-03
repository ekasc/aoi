# Public natural-photo face-index evaluation

Status: benchmark construction attempted, ground truth found unreliable, no
evaluation run. No recall or false-pair numbers are reported because the labels
cannot be trusted. This file records what was built, what failed, and what a
trustworthy benchmark needs.

## Goal

Decide whether cluster-first recognition generalizes from synthetic mosaics to
natural photographs of known identity pairs, using public internet data only.

## Approach

A Wikimedia Commons builder downloads curated category members through the
structured MediaWiki API, not search-result HTML. It records provenance, checks
licenses, verifies publisher hashes where it downloads originals, dedupes by
content hash, and caches so reruns resume.

```sh
python3 scripts/prepare-public-pair-benchmark.py --probe
python3 scripts/prepare-public-pair-benchmark.py --build --pairs bush-laura,clinton-hillary,obama-michelle
```

Ground truth was meant to come from category membership plus a cross-check
against each image's own category list. The output lands under
`.expo/face-benchmark/public-natural/<pair>/`, which is gitignored. No image is
committed.

## Pair selection

Pairs were chosen for category availability and variation, not for expected
model success:

| Pair | Both-together categories | Solo categories | Negative | Groups |
| --- | --- | --- | --- | --- |
| George W. Bush + Laura Bush | Laura and George Bush (482) | George W. Bush in 2005, Laura Bush in 2005 | Dick Cheney 2005, John Kerry 2005 | Bush and Cheney 2004/2008 |
| Bill Clinton + Hillary Clinton | Bill and Hillary Clinton 1993/1994 | Bill Clinton 1993, Hillary Rodham Clinton 1993 | Al Gore 1993, George H. W. Bush 1993 | Bill Clinton and Al Gore |
| Barack Obama + Michelle Obama | Michelle and Barack Obama in 2010 | Portraits of Barack Obama, Michelle Obama 2010 months | Hillary Rodham Clinton 2009 | Barack Obama and Joe Biden |

## Provenance and licensing

Every downloaded image records its Commons page, source URL, license, artist
where available, publisher SHA-1, content SHA-256, and benchmark role in a local
`sources.json`. Licenses observed across the build: Public domain 205, CC BY 2.0
12, CC BY-SA 2.0 7, CC BY-SA 4.0 3, CC BY 4.0 1. Only images whose license is in
the accepted public-domain or CC set were downloaded.

## Counts from the attempted build

| Pair | ref A | ref B | positive | solo-a | solo-b | negative | groups |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bush-laura | 4 | 2 | 20 | 15 | 15 | 25 | 15 |
| clinton-hillary | 4 | 4 | 0 | 15 | 15 | 0 | 15 |
| obama-michelle | 4 | 4 | 20 | 15 | 15 | 6 | 15 |

These counts are far below the target and, more importantly, the labels are
wrong.

## Why the benchmark was not run

Category membership is a weak proxy for who is actually depicted. Concrete
failures found in the downloaded set:

- Solo folders contain group photos. A "Michelle Obama in March 2010" member is
  a photo of Michelle Obama with Hillary Clinton and award honorees. A "Laura
  Bush in 2005" member is a photo with another head of state.
- Group folders contain unrelated crowds and even a different president's
  inauguration, because the target's name appears in the file's categories for
  an unrelated reason.
- Negative and group folders contain document scans, letter covers, and
  approval-rating charts. Filtering to JPEG removed the charts but not the
  scans.
- The Clinton positive and negative categories yielded zero images after the
  cross-check, so that pair has no positives at all.
- The cross-check against each image's own categories removes the partner when
  they are named, but cannot remove a third person who is also in the photo.
  That is the dominant error.

Running the evaluator on this set would produce numbers driven by label noise,
not by recognition. The task's own rule is to exclude ambiguous images rather
than weaken ground truth, so nothing was run.

## What a trustworthy natural benchmark needs

1. Per-image verification that the expected people are the ones depicted.
   Human review is the reliable path. A second option is face-count plus
   identity verification, but identity verification uses the recognizer under
   test and would bias the result.
2. Face-count verification alone (solo = one face, group = two or more) can
   clean the solo and group folders, but it pre-filters on Apple Vision, which
   would hide the detection failures this benchmark is meant to expose. It can
   only be used for the identity comparison, with detection recall reported
   separately on the unfiltered set and the circularity stated.
3. A larger, curated per-pair catalog with manual spot checks, the way the
   existing eight-image public-figure set was built, rather than whole
   categories.
4. Enough pairs and enough hard negatives. The public-figure space makes truly
   similar-looking negatives scarce, so siblings and lookalikes may not be
   available from Commons at all.

## Decision gate

The recognizer was not tested. The blocker is benchmark ground truth, not the
Vision + SFace stack.

- A. Does cluster-first generalize to natural photographs? Unknown. No
  trustworthy natural benchmark exists yet.
- B. Does it materially outperform the fixed reference? Unknown for the same
  reason.
- C. False-pair behavior? Unknown.
- D. Best strategy? Unknown.
- E. Is Vision + SFace the main bottleneck? Unknown. The synthetic benchmark had
  perfect detection and could not answer this.
- F. Gate: continue public testing first.

The next public step is a verified benchmark, not a different recognition stack.
The private-photo path already has a labeller that produces verified labels by
hand, so it remains the more reliable route to a real answer.

## Limitations

- Commons categories are curated for topical grouping, not for identity ground
  truth in photographs.
- Public-figure photos are heavily event and group oriented, which is the
  opposite of a couple-photo library.
- Public figures do not provide the hard negatives (siblings, lookalikes,
  recurring friends) that matter most for false-pair risk.
- This benchmark is not representative of a consumer photo library.
- No downloaded image is committed. The builder and this note are the committed
  artifacts.
