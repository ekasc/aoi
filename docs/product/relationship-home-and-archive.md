# A relationship home built from shared content

Aoi is a private home and archive for two people. Its history comes from what they intentionally share. Camera-roll discovery is not the product, an onboarding step, or a paid benefit.

## Existing functionality and the decision to reuse it

The audit covered these sources before the screen rewrite:

| Area | Existing source | Decision |
| --- | --- | --- |
| Us | `app/(app)/(tabs)/together.tsx` | Replace the local-photo discovery canvas with a relationship home. |
| Sky | `components/home/memory-sky.tsx`, `features/home/day-sky.ts`, `features/time-together/time-together.ts` | Keep the sky renderer and calendar-day count. Feed it shared occurrences, not imported photo dates. |
| Navigation | `app/(app)/(tabs)/_layout.tsx` | Keep Memories, Us, Plans, and Space and their existing stacks. |
| Posts and shared posts | `features/moments/moments-context.tsx`, `features/moments/use-story-feed.ts` | Read the same shared moments store. No new post type or content copy. |
| Memories and gallery | `app/(app)/(tabs)/(memories)/index.tsx` | Keep oldest-first order, unread landing, pending sends, editing, deletion, paging, photo viewer, and feed/gallery offsets unchanged. |
| Responses | `components/home/us-exchange.tsx`, `features/responses/` | Keep exchanges attached to their original memory. Do not fabricate new activity events. |
| Letters | `features/letters/`, `app/(app)/letters.tsx` | Link only a ready unopened letter. Never expose its caption or body in Us. |
| Little things | `features/partner-details/`, `app/(app)/profile/little-things.tsx` | Keep private per-user details private. Link the existing screen, never use its text as shared activity. |
| Plans and calendar | `features/calendar/`, `app/(app)/(tabs)/plans.tsx` | Show the earliest unexpired event explicitly marked together. Select its date in Plans. Goals and plans do not become memories automatically. |
| Relationship dates | `app/(app)/profile/edit-relationship.tsx`, `features/calendar/calendar-date-utils.ts` | Retain optional start date and milestones. Remove the photo-discovery explanation. |
| Chapters and history | `features/moments/chapters.ts`, `app/(app)/chapter/[id].tsx` | Use existing anniversary ranges and chapter detail. Monthly archive chapters remain in Memories. |
| Resurfacing | `features/moments/resurface.ts` | Reuse same local month/day, at least one year earlier. No unrelated random memory fallback. |
| Subscription | `features/subscription/`, `packages/shared/src/plus.ts` | Preserve authoritative Space entitlements and existing quotas. Change positioning, not purchase logic. |
| Recognition | `features/album/`, `features/face-index/` | Remove provider from the authenticated product tree. Keep experiments and evaluations isolated. |

## What Us means

The hierarchy is one scroll with a virtualized chronological feed:

1. The relationship sky and days together.
2. Current shared activity, when present. A ready letter, the next together plan, and the latest shared memory within seven days qualify.
3. On this night, when a published memory matches today's calendar month/day in an earlier year.
4. Our constellations, when completed relationship-year chapters contain at least two eligible loaded memories.
5. Our story, the existing shared feed in occurrence order, oldest first. A published memory with a future occurrence date still remains in this archive, but it does not light today's sky or appear as current activity. Pending records retain their retry controls. Earlier history loads only on request.

Optional sections disappear when they have nothing relevant. The story still distinguishes a successful empty read from loading and failed reads. Failed calendar or letter reads retain retry actions. Free and Plus see the same relationship home.

On this night is an editorial heading for the existing on-this-day rule. It does not claim that a memory happened at night. Us does not add another notification schedule.

The relationship start date counts as day one. The count uses local calendar days, including DST and leap-year handling already defined in `getDaysTogether`. Missing, invalid, or future start dates do not invent a count. Us offers the existing date editor instead. More memories do not create more days together.

## Constellations are relationship-year chapters

The first supported constellation is a completed year together, with the existing `anniversary:{year}:{endYear}` identity and date-range membership. The selector uses the same chapter eligibility as detail, including the exclusion of goals. It shows the latest three supported years.

Each illustration has at most five deterministic points, ordered by the chapter's loaded memories. Lines are decorative. They imply neither inferred relationships nor recognition clusters. The accessible control names the chapter; points add no screen-reader nodes. The chapter route loads its actual range independently of the feed cursor.

There is no named album, trip-membership, or chapter-editor model in the current app. A trip tag alone does not establish a collection. Arbitrary monthly buckets are not promoted to meaningful constellations. Richer explicit chapters need stable membership and ownership before they can appear here.

Us derives resurfacing and chapter previews from the loaded shared feed. It does not secretly page the whole archive or claim these previews are exhaustive. Loading earlier memories can reveal another supported year or an eligible resurface. Complete historical discovery needs a bounded server read or persisted chapter index later.

## Memories stays the deliberate archive

Memories remains the complete reading and media-browsing destination. Its chronological behavior, composer, gallery, pending pipeline, per-memory interactions, and chapter navigation are unchanged. Us opens the same memory detail instead of duplicating editing or response state. Media playback stays in the existing components.

Old local photo copies remain accessible under Space through Local photo copies. They are device-only and are not shared archive content. No migration, upload, scan, biometric deletion, or deletion of originals runs as part of this change.

## Free and Plus

Free remains a complete couples app. Shared notes, the sky, day count, relationship home, everyday resurfacing, chronological reading, gallery, existing chapters, plans, responses, and Little things are not paywalled. Privacy and account data export are not subscription benefits.

The implemented Plus benefits remain:

- Shared media storage increases from 250 MiB to 5 GiB per Space.
- The one-active-future-letter limit is removed.
- PDF chapter keepsakes use the existing server-authoritative Plus gate.

One entitlement covers both members. There is no unlimited-storage claim, recognition benefit, separate partner subscription, or history-reading cutoff. The paywall sells storage and preservation that exist today.

Deeper archive services, sky history, richer chapters, recaps, and capsules are possible future Premium benefits. They are not included in the current purchase promise. Existing everyday resurfacing stays free even if richer historical services arrive later.

## Future time travel requires real history

`relationshipSky(moments, startDate, asOf)` separates the sky's clock from today's UI. It counts days at `asOf` and excludes occurrences after that instant. It is a tested date projection, not a stored historical snapshot or a released time-travel control.

A real history feature still needs decisions and systems for:

- Versioned relationship dates, edits, deletions, memberships, and access changes. Today's records cannot reconstruct what existed at an earlier instant.
- Timezone and date-only selection rules. An instant cutoff is not the end of a selected calendar day.
- Bounded historical reads and explicit chapter memberships, rather than loading every memory into the home screen.
- Preservation guarantees, storage lifecycle, restore behavior, entitlement changes, and export consistency.
- User-authored capsule contents and release rules. Existing sealed letters are not silently relabelled as a new capsule system.
- Recap selection and review controls that operate only on shared content, without invented scenes or automatic camera-roll ingestion.

No placeholder buttons or fake Premium locks stand in for those systems.

## Recognition is inactive research

The authenticated layout no longer mounts `AutomaticAlbumProvider`, including in development. Previously enabled local discovery therefore cannot resume from app startup. Us never imports recognition state, a face model, or a photo-library reader. Old check-photo deep links redirect to Us without loading the scanner.

`/dev-album` is an unlinked development-only experimental tool and explicitly says recognition is inactive in the product. Its underlying experiments remain on disk. AVA, PIPA, Wikimedia, and private-evaluation findings retain their original limits. No threshold, model, alignment, benchmark, private API, or photos dataset changes accompany this pivot.

## Verification routes

The real Us screen is available in development at:

- `/dev-together?variant=empty`
- `/dev-together?variant=recent`
- `/dev-together?variant=historical`
- `/dev-together` for mixed media
- `/dev-together?variant=no-resurfacing`

`/dev-paywall` shows Free purchase copy. `/dev-paywall?state=plus` shows active Plus. Us has no entitlement branch, so its content and actions are identical on both plans. Populated previews persist sample letters and plans in browser storage; use a fresh preview session or clear that preview browser's local storage before inspecting an entirely empty world.

Verification for this change passed 2,671 tests across 258 files with `npx vitest run`, `pnpm run typecheck`, the strict accessibility audit with zero findings, and `npx expo export --platform web`. Scoped ESLint had zero errors and two existing `require()` warnings in the sky and audio-player tests. `git diff --check` passed.

Agent-browser inspected empty, recent, historical, mixed-media, no-resurfacing, Free paywall, and active Plus states. The 320-point preview had no horizontal overflow. Live voice-playback controls measured 44 by 44 points after correction. The final DOM had no nested buttons. Keyboard activation of a constellation reached the protected chapter route, then redirected to sign-in on web. The temporary browser and preview server were closed.

Screenshots and check logs stay under gitignored `.expo/us-pivot/`. Web previews render the real screens but omit the system tab bar. They do not establish native navigation, VoiceOver behavior, device keyboard layouts, store purchases, backend PDF export, or physical-device sky performance. Those require device and service checks before release.
