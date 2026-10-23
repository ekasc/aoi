---
status: exploration-not-adopted
date: 2026-10-17
updated: 2026-10-18
---

# Space kinds: a group is a container, not a second product

## Current direction: keep the couples product

As of 2026-10-18, this proposal is **not adopted and is not the roadmap**. Keep Aoi
couples-focused with the existing two-person space model. Do not start group support,
multi-space support, or group-driven renames based on this document.

Finish the couples beta and address the beta-readiness blockers. Use tester feedback
to decide which existing features to keep or cut; keeping the couples focus does not
mean keeping every feature.

The exploration below is retained for context. Its claims that invitation limits cap
business growth, that groups outperform couples by a fixed multiple, and that printing
should be the revenue model are not established conclusions. Its migration order and
feature split are not approved implementation instructions. Revisit them only if a
future product decision explicitly adopts group support.

## Original proposal, not adopted

Generalize the **container**, not the features.

A `Space` holds one to many members. A `kind` (`pair` | `group`) is set at creation, and every
feature declares the shape it requires: `pair` features render only in a pair space, `any` features
render in both. A couple is a two-member space, not a separate product.

The pair-only features are not generalized and not deleted. They are gated. They are the reason the
couples product is worth paying for, and generalizing them would produce a worse group container
competing with free ones.

Order of work: domain renames and neutral copy first, then multiple spaces per user, then N members,
then the group artifact. The current beta is not forked.

## Why now

Two things arrived together, and only one of them came from a user.

**A tester asked for family and friends.** One report is not demand. What makes it worth acting on is
the second thing.

**The couples product's growth loop is capped at 1.0 by construction.** A space can hold exactly one
partner, and the slot is never reusable:

- `packages/api/src/db/d1-schema.ts:168` — `uq_space_members_user_active`, one active space per user
- `packages/api/src/db/d1-schema.ts:171` — `uq_space_members_space_partner_active`, one active partner per space
- `packages/api/src/domains/spaces.ts:432` — a space that had a partner refuses another
  ("This space already had its partner — start a new space together"), and the pairing-isolation work
  makes the slot non-reusable in both directions

Every user can therefore invite exactly one person, once. That is a growth model with a hard ceiling,
and no amount of product quality raises it. This is the strongest argument for the change, and it has
nothing to do with features.

## What the market evidence says

Checked 2026-10-17. The Tinybeans and Qeepsake figures are from the company's own ASX filings and
acquisition release. The Between and Paired figures are **third-party estimates** (AppGoblin,
Sensor Tower as reported), so read them as orders of magnitude, not accounts.

| Product | Shape | Money | Note |
|---|---|---|---|
| Between | Couples messenger, photos, calendar, special days — this app's feature set | ~$100K/month, **~75% advertising**, 14 years old; Plus is $13.99/yr | Millions of downloads. Loved, not paid for |
| Paired | Couples **coaching**, not memory | ~$200K/month est.; 8M downloads; $74.99/yr | The couples leader sells improvement, not keepsakes |
| Avocado | Couples messenger, 1M users | Acquired by Life360, shut down within months | "Couples-only has no growth vector beyond couples" |
| Tinybeans (ASX:TNY) | Privacy-first **family** memory | ~$1.79M/quarter; ~93–95K paid subs; ARPU ~$75; LTV ~$472; **95% retention** | ~4x the couples leader; first EBITDA-positive quarter after 14 years |
| Qeepsake | Prompts → journal → **printed book** | ~50K paid subs, ARPU ~$64, acquired for US$2.7M | Monetized the book, not the app |

Category sizes as claimed by Tinybeans' own investor material: family/parenting apps ≈ $1.9B;
**photobooks and personalised photo ≈ $3.5–5B**; ~132M births a year as a recurring trigger event.

Two conclusions, in order of importance:

1. **Groups out-earn couples at the leader level by roughly 3–4x, with far better retention.** A
   couple can churn by breaking up; a family churns by growing up. Births are a repeatable
   acquisition trigger, which couple-formation is not.
2. **The bigger lever is what is sold, not who is in the space.** Subscription is the smaller half of
   the family business and the photobook is the faster-growing half. Qeepsake's 50K subscribers were
   worth buying because of journaling-to-book conversion. The artifact is also the only model in which
   group size stops mattering: the Plus tier is billed per space, so one subscriber covering five
   people is a discount, whereas a printed keepsake is billed per order.

Sources:

- [Tinybeans Q3 FY26 activities report](https://investorpa.com/announcement-pdf/20260428/285467.pdf)
- [Tinybeans acquires Qeepsake](https://www.prnewswire.com/news-releases/tinybeans-acquires-qeepsake-creating-the-leading-privacy-first-family-memory-platform-302603273.html)
- [Between, AppGoblin estimates](https://appgoblin.info/apps/458035189)
- [Paired, AppGoblin estimates](https://appgoblin.info/apps/1469609343)
- [Why Avocado failed](https://unicornburn.com/autopsy/avocado-app)

## Why the container, and not the features

A space is an archive with a membership. Two people are the common case; five is the same archive
with four more members. Nothing about a timeline, an album, a list or a plan assumes exactly two
people. What assumes exactly two people is the *intimacy* layer built on top: a letter addressed to
your person, a nudge between two phones, a weekly question you both answer, a sky with one star per
day together.

So the split is not "which features are easy" but "which features mean something with five people in
the room." A group with a squeeze button is noise. A group with a printed year is a product.

## Pair-only — keep and gate

| Feature | Why it cannot generalize |
|---|---|
| `features/home/day-sky.ts`, `day-sky-spatial.ts` | One star per **day together**. The sky's clock is an anniversary; in a group there is no such date |
| `features/time-together` | The same clock |
| `features/letters` (38 files) | Addressed to one person. A group letter is a time capsule — a different feature with different rules |
| `features/question` (18 files) | Private reflection that unlocks on both answers. In a group it is an icebreaker, with different content and a different mechanic |
| `features/squeeze` (11 files) | A two-way nudge. In a group it is noise |
| `features/relationship` | Phases of a relationship |
| `features/partner-details` | A portrait of the other person; becomes a member sheet, or nothing |
| Anniversary framing in copy | `Since`, "days together", `app/(app)/profile/edit-relationship.tsx:188` |

A group should not receive these, and a couple should not lose them.

## Any-space — the archive

`moments` (timeline) · `album` (plus key fan-out) · `collections` (lists) · `calendar` (plans) ·
`someday` · `responses` · `export` · `chapters`/keepsake

This is what both shapes get, and it is where the printed artifact is made from.

The key management for the album is already shaped for this: the wire format wraps a key **per
recipient device** (`packages/shared/src/album-protocol-wire.ts:212-241`, `recipientDeviceId`,
`recipientRevision`, one `wrappedKey` per envelope). N members is envelope fan-out plus a device
registry — not a protocol redesign. `recipientRevision` is the counter re-keying needs on join and
leave. One product question must be answered before it is built: **does a member who joins later read
the history before they arrived?** Re-wrapping existing items for them is possible and is O(items);
deciding not to is cheaper and easier to explain.

## What to cut

**`location` (15 files).** Freeze or remove it. It is not this product: the category leader is
Life360, whose business is trust and safety with the support costs that implies. Half-built location
tracking carries background permissions, battery complaints, and platform obligations, and it feeds
no artifact. Family utility belongs in `calendar`, where it already is.

**Anniversary copy in group spaces.** The `kind` decides the words; a group does not have a `Since`.

Everything else stays. Deleting letters or the sky to "make room" for groups would trade the thing
that is distinctive for a thing that is free.

## Renames

Domain vocabulary first. Names teach the next feature what the world looks like, and `partner` in the
model keeps re-teaching everyone that there are exactly two roles.

| Now | Becomes | Why |
|---|---|---|
| `getActiveSpaceId` — 96 calls across 25 files | a membership-scoped call, e.g. `requireSpaceMembership(spaceId, userId)` | The concept changes from "the space" to "this membership". Doing the rename first makes all 96 sites visibly wrong instead of silently wrong |
| `ck_space_members_role in ('you', 'partner')` | drop the role, or `('creator', 'member')` | A constraint that literally cannot name a third person |
| `partnerAccent` / `partnerAccentInk` | the first of N member accents | Needs an ink palette per theme, and the contrast suite has to re-prove each new ink |
| `BeachThemes` / `BeachThemeId` | `Themes` / `ThemeId` | Stale container name for two themes; free while renaming |
| ~12 user-facing "your partner" strings | read from `space.kind` | `plans.tsx:154`, `together.tsx:154-188`, `account.tsx:520,537`, `onboarding-wizard.tsx:504` |

`time-together` and `relationship` keep their names: they are pair-only, so the names stay honest.

## Migration order

Your own store checklist notes there are **no down-migrations** — backup is the rollback. So each step
below ships alone, and the irreversible ones are last.

1. **Renames + neutral copy.** No schema change, no behaviour change. Do this first because every later
   line inherits the vocabulary.
2. **Multiple spaces per user.** Drop `uq_space_members_user_active`, make the active space an explicit
   selection, add a switcher. Independently valuable for couples (a pair who also want a family space),
   and it is the load-bearing refactor: 96 call sites.
3. **N members.** Replace the role check and pairing isolation with membership lifecycle rules; fan out
   key envelopes; N member accents; `kind`-aware copy; member removal by the creator.
4. **The group artifact.** Printed keepsake from a group's archive; group size cap; pricing.
5. **Retire `location`** if step 1 confirmed nobody uses it.

## What we will not build

Chat. Video. Per-thread privacy inside a space. Moderation tooling beyond "the creator removes a
member". Location. Each is a free incumbent's strength, and none of them feeds the archive.

## Sequencing against the beta

The couples product is in a tester's hands and the readiness checklist stands at one of four gates.
Groups are the next cycle, not a change to this one — a beta that tests both tests neither.

Steps 1 and 2 are safe to do while the beta runs. Step 3 changes what the beta is measuring and should
wait for it.

## Consequences, including the ones we do not like

- **Positioning gets harder.** "For couples" converts better than "for any group of people who want a
  private archive". Mitigation: keep marketing couples-first and simply stop forbidding groups, rather
  than rebranding around generality.
- **The couples funnel is the strongest thing this product has.** A pair that uses it daily is the
  retention base the groups feed off, not a legacy segment.
- **Support load grows with group size.** Five people can disagree about membership; two rarely do.
  Member removal is the only tool, and it should be built with the same care as invite rotation.
- **Plus pricing is wrong for groups.** Per-space billing means one payer covers five people. Either cap
  group size or move revenue to the artifact. This is a decision to make before step 4, not during it.
- **The pair-only features become liabilities if nobody uses them.** `letters` is 38 files and
  `question` is 18. If the beta shows they are unused, cutting them pays for part of the group work.

## What has not been verified

- Whether anyone wants group spaces beyond one tester. One report is a signal to plan, not a signal to
  build. The test that would settle it: three testers naming a specific group that sharing and the
  printed chapter cannot already satisfy.
- How much of `letters`, `question` and `location` testers actually use. Nothing in this document
  depends on that being known, but step 5 does.
- The third-party estimates above. No figure for Between or Paired is audited; Tinybeans' own filings
  are the only numbers here from the companies that earned them.
- Whether the album's key fan-out cost is acceptable at group sizes with several devices per member.
  The wire format allows it; nobody has costed a re-wrap of an existing archive.
