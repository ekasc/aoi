# PIPA face-index evaluation

Status: blocked at the image-retrieval permission gate. No pair dataset was
constructed and no recognition evaluation ran. This is an access investigation,
not a performance result. The PIPA investigation stopped without a performance
commit or push. The later [AVA benchmark](ava-active-speaker-face-index-evaluation.md)
is the executable public test.

The Wikimedia category builder is exploratory, has unverified labels, and is not
used here. Its category heuristic has not been repaired or reused.

## Dataset sources

Inspected [PIPA metadata](https://github.com/coallaoh/PIPA_dataset) at repository
commit `261ccd8794b737d0bbf80bab24c3f502701be1a1`:

- `README.md`, `all_data.txt`, and `crawler.py`.
- All eight `split_{test,val}_{original,album,time,day}.txt` files.
- The original [PIPA paper](https://openaccess.thecvf.com/content_cvpr_2015/papers/Zhang_Beyond_Frontal_Faces_2015_CVPR_paper.pdf),
  sections 3.1 and 3.2, and table 1.
- The [protocol paper](https://openaccess.thecvf.com/content_iccv_2015/papers/Oh_Person_Recognition_in_ICCV_2015_paper.pdf),
  section 5.1.

Local copies, source URLs, hashes, access-probe responses, and the metadata audit
are under gitignored `.expo/face-benchmark/pipa/`. No photos, face crops, or
embeddings were downloaded or generated. No mirror was used.

## Annotation interpretation

`all_data.txt` contains eight whitespace-separated integer columns. Each row
annotates one person instance, not one photograph.

| Column | Meaning |
| --- | --- |
| 1 | Flickr photoset ID, identifying the album |
| 2 | Flickr photo ID, identifying the full source photograph |
| 3 | Head box x coordinate |
| 4 | Head box y coordinate |
| 5 | Head box width |
| 6 | Head box height |
| 7 | Person identity ID. The same ID denotes the same annotated person across photos |
| 8 | Dataset subset code |

A protocol file repeats these eight columns and adds column 9, the registration
or evaluation side. Side `0` registers identities; side `1` evaluates them. The
published protocol also swaps the sides and averages the two results.

The boxes describe heads, not necessarily visible faces. The original paper
allows partially or fully occluded heads and boxes partially or fully outside
the image. Neither the metadata nor the current crawler establishes the exact
original annotation-image resolution. A box must not be applied to an arbitrary
Flickr rendition without establishing its coordinate scale first.

### The README's subset enum is wrong for these files

The README lists train, validation, test, and leftover as `0, 1, 2, 3`. The actual
files and the original paper's instance counts establish this mapping:

| Code | Subset | Instances | Unique photos | Unique identities |
| ---: | --- | ---: | ---: | ---: |
| 0 | Leftover | 11,437 | 10,483 | 54 |
| 1 | Train | 29,223 | 17,000 | 1,409 |
| 2 | Validation | 9,642 | 5,684 | 366 |
| 3 | Test | 12,886 | 7,868 | 581 |

Overall there are 63,188 rows, 37,107 unique photo IDs, and 2,356 identities.
Subset photo and identity counts are not additive. The leftover set holds
excess instances of 54 identities already present in train, validation, or
test. Those overlaps agree with the collection procedure in the original paper.

All inspected protocol rows match an eight-column row in `all_data.txt`.
The validation original file contains 9,640 rows, two fewer than validation
album and time. The day files are smaller subsets. A future builder must use
the supplied rows, not assume identical membership across protocols.

## Image retrieval and licensing blocker

The supplied crawler uses the official Flickr `photos.getSizes` API and requires
an application key. It defaults to the `Original` size, but explicitly says the
original PIPA resolution is uncertain. It neither checks current licenses nor
deduplicates its person-instance list before downloading photographs.

The official [getInfo documentation](https://www.flickr.com/services/api/flickr.photos.getInfo.html)
states that public-photo requests do not require user authentication, but
`api_key` is required. No Flickr-related environment variable is available in
this session. Keyless `getInfo` and `getSizes` requests both returned HTTP 200
with the application-level failure:

```json
{"stat":"fail","code":100,"message":"Invalid API Key (Key has invalid format)"}
```

Two public PIPA photo-page probes returned HTTP 200. Their page metadata exposed
source-image URLs, photo IDs, image sizes, and CC BY 2.0 license links. This shows
that some sources survive. It does not measure dataset survival or provide an
authorized bulk-retrieval method.

The [Flickr terms](https://www.flickr.com/help/terms), last revised July 24, 2025,
prohibit "scraping or otherwise using any data mining, robots or similar data
gathering or extraction methods on or in connection with the Services," except
where expressly permitted. Consequently, the public pages were not turned into
a bulk scraper, and no site-owned API key was borrowed.

The [API terms](https://www.flickr.com/services/api/tos/) also restrict cached
photos to reasonable periods for providing services to Flickr users. Whether
this local product-research benchmark is permitted is not established merely
by obtaining an API key. The retrieval route and retention purpose need
supportable authorization.

The original paper says its photos had Creative Commons Attribution licenses.
That historical statement does not establish each surviving photo's current
license or the permission for a new retrieval method. Image copyright licenses
also do not settle privacy or personality rights. A future permitted download
must retain the current source URL, license, attribution, and photo ID, skip
private/deleted sources, and never replace a missing ID with another image.

To resume, provide a valid Flickr application key locally and establish that
Flickr permits the proposed research downloading and caching, or provide a
first-party authorized source archive with documented provenance and use terms.
A random repaired mirror is not a substitute. No credentials were written and
no alternate dataset was selected.

## Split protocols and photo leakage

The supplied protocols have different purposes:

- Original separates odd and even instances from an album-ordered list. Nearby
  photos can be almost identical.
- Album separates albums where possible. The paper says some albums are shared
  to balance the two sides, so it is not an absolute album-disjoint guarantee.
- Time separates older and newer photo-taken dates. Instances missing dates are
  distributed evenly, so it does not guarantee a date gap for every identity.
- Day manually separates appearance changes or evidence of different days.
  It prunes unbalanced instances and identities with insufficient support.

These are person-instance splits, not global photograph splits. Many photos
contain protocol rows on both sides:

| Protocol | Test instances | Test photos | Test mixed-side photos | Validation instances | Validation photos | Validation mixed-side photos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original | 12,886 | 7,868 | 1,688 | 9,640 | 5,684 | 1,416 |
| Album | 12,886 | 7,868 | 1,699 | 9,642 | 5,684 | 1,415 |
| Time | 12,886 | 7,868 | 1,873 | 9,642 | 5,684 | 1,357 |
| Day | 4,969 | 3,840 | 233 | 2,152 | 1,848 | 57 |

A future pair benchmark must prevent reference photographs from entering the
query set, even if their target-instance rows have different side labels. It
must also check content hashes because different photo IDs can hold the same
image. Neither check can be replaced by an instance-side check.

## Annotation-only pair feasibility

The local audit counted distinct co-occurring identity pairs without running
recognition. It applied a conservative photo-level rule:

1. Exclude a photograph if its protocol rows span both sides.
2. Require at least three distinct registration photos per identity.
3. Require at least ten distinct query photos with both target identities
   explicitly represented on the query side of that protocol.

It counts target membership from protocol rows for eligibility, not from extra
`all_data.txt` instances lacking a protocol-side assignment. The complete
`all_data.txt` identity set would still supply photo-category ground truth.

| Protocol | Test eligible pairs 0 to 1 | Test eligible pairs 1 to 0 | Validation eligible pairs 0 to 1 | Validation eligible pairs 1 to 0 |
| --- | ---: | ---: | ---: | ---: |
| Original | 2 | 3 | 3 | 3 |
| Album | 4 | 7 | 4 | 4 |
| Time | 5 | 4 | 16 | 13 |
| Day | 6 | 4 | 2 | 1 |

These are preliminary eligibility counts, not selected or evaluated pairs.
They do not check surviving links, licenses, usable registration faces,
solo/group coverage for both targets, or enough negatives. Counts from the two
directions cannot be added to claim that many distinct pairs.

A less restrictive pair-specific photo exclusion may preserve more coverage.
That requires explicit leakage tests rather than treating all instance splits
as photo-disjoint. No pair selection rule was relaxed to produce a result.

The cached audit can be rerun with:

```sh
python3 .expo/face-benchmark/pipa/inspect_metadata.py
```

## Photo-category ground truth

The required source of truth is the union of annotated identity IDs for each
photo ID across `all_data.txt`. For distinct targets A and B:

| Category | Annotation rule |
| --- | --- |
| Positive | Both A and B are in the set |
| Solo A | The set is exactly `{A}` |
| Solo B | The set is exactly `{B}` |
| Group | Exactly one target is present and at least one additional identity is annotated |
| Negative | Neither target is present. Prefer a nonempty annotated identity set |

These categories are mutually exclusive for a fixed pair. A singleton identity
set does not prove a single visible person. A negative is an annotation-ground-
truth negative, not a visually proven no-target photo.

No category builder was implemented after the access gate failed. Thus no
annotation-to-category tests or reference/query integrity checks have run for a
constructed dataset. The local metadata audit checked column counts, side values,
row uniqueness in `all_data.txt`, and protocol-row membership only.

## Enrollment and detector analysis

No enrollment instances were selected. A future deterministic metadata rule
must select three to five registration instances per target without recognition
scores. Full registration photos with multiple people require head-box-assisted
association of the target detection. Feeding every reference face to the target's
reference set would contaminate enrollment.

Queries must remain full natural photographs. Annotation head crops must not
become recognition inputs. Head boxes can support one-to-one geometric matching
to detected faces after the coordinate scale is established. This matching must
not use identity predictions. Occluded or out-of-frame annotated heads must be
reported separately where the annotations permit that distinction; they are not
necessarily detectable faces.

Target-head detection recall and the counts of positive photos with both, one,
or neither target detected are not measured. There are no evaluated target heads
or photographs, so there is no rate denominator.

## Recognition results

| Requested measurement | Result |
| --- | --- |
| Protocol used for recognition | None |
| Identity pairs evaluated | 0 |
| Full photographs evaluated | 0 |
| Baseline at production threshold 0.72 | Not run |
| Cluster-first top-k, corpus references | Not run |
| Cluster-first top-k, corpus all | Not run |
| Micro and macro recall | Not measured |
| Category-specific false pairs and false-pair rates | Not measured |
| Pairs improved, tied, or regressed | Not measured |
| Identity ambiguity, attachments, contested clusters | Not measured |

`corpus references` remains the proposed clean held-out benchmark.
`corpus all` is a separate transductive full-library experiment, because query
faces affect clustering. Their results must not be pooled.

The eight strategies, max, mean, median, trimmed-mean, majority-vote,
member-support, top-k, and representative, were not compared on PIPA. There is
no real-data evidence of member-support's cluster-size bias. The existing
clustering sweep at 0.40, 0.50, 0.55, 0.65, and 0.75 was not run. No threshold,
model, detector, alignment routine, or production service was changed.

## Failure analysis

There are no measured missed positives or false pairs. No detector,
alignment, embedding, clustering, attachment, lookalike, reference, or query
failure was assigned. Recognition cannot diagnose an image-access failure.
Any eventual false pair must retain the annotated identity set and the
face-to-cluster-to-attachment-to-query evidence chain. Annotation limitations
must remain distinct from proven recognition errors.

## Dataset limitations

- PIPA comes from older Flickr albums, not modern phone camera rolls.
- The original collection used 111 uploaders and album-specific selection.
  Its demographics and social contexts do not establish representativeness
  across couples.
- Annotators marked recurring people and at most ten people in crowded scenes.
  The paper explicitly says not every person was tagged. Occluded heads may
  also be annotated. Target absence in annotations is not proven visual absence.
- Cross-album identity merging was done within an uploader's albums, not
  exhaustively across all uploaders.
- Deleted/private photographs and license changes can bias any surviving subset.
  This investigation did not measure the survival fraction.
- Current source renditions may differ from the images used for head annotation.
  Detector metrics require a verified coordinate transform.
- PIPA results would still not prove performance for actual Aoi users.

## Decision gate

A. Natural-photo generalization is unknown. No natural-photo run occurred.

B. Held-out improvement over fixed-reference matching is unknown.

C. False-pair cost is unknown. Zero evaluated photos is not zero false pairs.

D. The best strategy across identities is unknown.

E. The detector's fraction of misses is unknown.

F. The transductive benefit and its cause are unknown. Neither corpus mode ran.

G. This investigation provides no new performance evidence to justify private
couple validation. It also provides no reason to replace the recognition stack
or stop the feature. Resolve authorized image access before interpreting PIPA.

Decision: `continue public benchmarking`.
