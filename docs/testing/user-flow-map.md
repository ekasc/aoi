# Aoi user-flow map

This is the catalog of currently implemented user-facing flows in the checked-out Aoi app. It covers the main happy paths, their material branches, and the failure states a person can actually hit.

It is not an infinite permutation list. A flow with two optional fields, two permission outcomes, and three network states has more combinations than a test suite should enumerate. The tables list the branches that change what the person sees or whether data is saved.

**Source of truth:** `app/**` routes, the feature contexts under `features/**`, and the product contracts in `docs/product/`. Generated from Aoi `048f7838`.

## How to use this map

1. Pick by risk, not by count: start with P0 flows in pairing, save/retry, account isolation, and recovery.
2. Each row is one testable journey. Branches are the variations that change what the person sees or whether data is saved.
3. Match the layer: `integration` for the real Hono/D1 boundary, `unit` for context/UI state, `native` for permissions/keyboard/audio, `manual` for comprehension.
4. Record the flow ID with the result so a failure is traceable.
5. Do not try to cover all 198 in one pass. Pick one area, test it end to end, fix what is visible, then move on.

Legend:

- **Layer:** `unit` — deterministic component/context behavior; `integration` — real Hono/D1 boundary; `native` — device/OS behavior; `manual` — requires a human judgment.
- **P:** `P0` data loss / account isolation / pairing / recovery, `P1` core product behavior, `P2` polish.

## Top-level map

```text
Launch
├─ signed out
│  ├─ landing → Apple / Google → sign-in
│  ├─ verify-code (deprecated → provider sign-in)
│  └─ invite link → sign in → join
├─ signed in, no space
│  ├─ create space → invite → Memories
│  └─ join space → code → Memories
└─ signed in, space ready
   ├─ Memories
   │  ├─ feed / gallery / unread landing
   │  ├─ new memory (note / photo / video / voice)
   │  ├─ memory detail → edit / delete / respond
   │  ├─ chapter detail
   │  └─ legacy capture deep link
   ├─ Us
   │  ├─ sky → add / manage / zoom / history
   │  └─ encryption and partner-sharing explanation
   ├─ Plans
   │  ├─ month / year / day
   │  ├─ new / edit / delete event
   │  ├─ goals
   │  └─ someday
   ├─ Lists (Ours)
   │  ├─ list → item
   │  └─ create / edit / remove
   ├─ Account
   │  ├─ theme / guide / relationship
   │  ├─ export / local photos
   │  ├─ album devices / phrase / restore
   │  ├─ Plus / legal
   │  └─ sign out / leave / delete account
   ├─ Partner portrait
   ├─ Weekly question
   └─ Squeeze overlay
```

## A. Launch, authentication, session

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| A01 | Launch signed out | `/` | first paint; redirect to landing; splash completes | unit | P1 |
| A02 | Sign in with Apple | `/(public)` | success; user cancels; provider error | native | P0 |
| A03 | Sign in with Google | `/(public)` | success; cancel; provider error; missing client ID | native | P0 |
| A04 | Deprecated email-code route | `/(auth)/verify-code` | informational screen; back to landing; provider sign-in | unit | P2 |
| A05 | Restore a stored session | launch | valid; expired; unreadable; offline | unit | P0 |
| A06 | Expired/invalid session | any protected route | redirect to sign-in; preserve no old data | integration | P0 |
| A07 | Sign out | Account | unregister push; clear SecureStore/tokens; return to landing | unit + native | P0 |
| A08 | Sign out while a request is in flight | Account | late response must not repopulate the next account | unit | P0 |
| A09 | Switch accounts | sign out → sign in | old space/media must not flash or return | unit + native | P0 |
| A10 | Delete account | Account → Danger zone | confirm; cancel; server failure; partner keeps shared history | integration + native | P0 |
| A11 | Delete account with active store subscription | Account | copy explains store billing must be cancelled separately | manual | P1 |
| A12 | Deep link to a protected route signed out | any deep link | auth first, then destination or safe fallback | manual | P1 |
| A13 | App foreground/background during session | launch/any | restore; refresh; no stale account data | native | P0 |
| A14 | Test sign-in seam | isolated E2E server only | 404 without flag; 401 without secret; real session when both set | integration | P1 |

## B. Onboarding, pairing, invitations

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| B01 | Choose create vs join | `/(auth)/space-setup` | create door; join door; back; sign out | unit | P0 |
| B02 | Create space | setup → identity | photo chosen/skipped; partner name; optional date; continue/back | unit | P0 |
| B03 | Skip relationship date | identity form | completes; no invented date; Account shows “Not set” | unit | P1 |
| B04 | Partner name validation | identity form | empty; whitespace; too long; valid; error remains until fixed | unit | P1 |
| B05 | Create with an active space already present | setup | API 409; no second space; message says leave first | integration | P0 |
| B06 | Invite minted | setup → handover | code shown; share sheet opens; cancel share; copy code | unit + native | P0 |
| B07 | Share invite | handover | share success; cancel; share failure; no false “joined” claim | native | P1 |
| B08 | Expired invite code | handover | regenerate before sharing; expired code not copyable as valid | integration + native | P0 |
| B09 | Manual partner-status check | invitation sheet | success updates state; failure reaches UI; existing space retained | unit | P1 |
| B10 | Join with a valid code | join identity → code | joins; sees creator’s pre-join memory; attribution correct | integration | P0 |
| B11 | Join with a wrong code | join code | useful error; can retry without restarting setup | integration | P0 |
| B12 | Join with an expired code | join code | error distinguishes expiry; creator can regenerate | integration | P1 |
| B13 | Join with an already-used code | join code | error explains used; no membership created | integration | P1 |
| B14 | Creator tries to join their own space | join code | 409; no duplicate membership | integration | P1 |
| B15 | Join while already in a space | join code | 409; message says leave first; invite not consumed | integration | P0 |
| B16 | Join a space whose partner slot is bound | join code | 403; slot never reusable; no history exposure | integration | P0 |
| B17 | Join an abandoned/archived space | join code | 404; no resurrection | integration | P0 |
| B18 | Two people create separate spaces | two devices | each sees own space; sharing a code from one does not merge them | manual | P0 |
| B19 | Partner joins while creator waits | creator foreground | foreground refresh shows joined without push | unit + native | P0 |
| B20 | Creator saves a memory before partner joins | create → Memories | partner sees it after joining with correct author | integration | P0 |
| B21 | Invite link does not open the app | invite message | fallback code instructions are understandable | manual | P1 |
| B22 | Invite link opened by wrong signed-in account | deep link | refuses or explains; does not join silently | integration | P0 |
| B23 | Partner leaves | Account → Leave space | confirm/cancel; shared history remains; leaver loses access | integration | P0 |
| B24 | Remaining creator invites someone new after partner left | invitation sheet | code can never admit; UI should not imply it can | manual | P1 |
| B25 | Last member leaves | Account → Leave space | space archives; invite dead; no active space remains | integration | P0 |
| B26 | New space after leaving | setup | new space does not move old history | manual | P1 |

## C. Capturing and saving memories

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| C01 | Empty feed → first memory | Memories empty | explicit first action; opens editor; no automatic tour | unit | P0 |
| C02 | Empty gallery → add | Gallery empty | action opens editor; not a dead end | unit | P1 |
| C03 | Save a note | composer | text-only; title/body limits; Keep enabled/disabled correctly | unit + integration | P0 |
| C04 | Save a photo from library | composer | permission allow/deny; selection cancel; upload pending | native | P0 |
| C05 | Take a photo | composer | camera permission allow/deny; cancel; orientation | native | P0 |
| C06 | Save a video | composer | selection; upload progress; playback after save | native | P1 |
| C07 | Record a voice note | composer | mic permission allow/deny; start/stop/cancel; playback routing | native | P1 |
| C08 | Multiple attachments | composer | add up to max; remove one; keep order | unit | P1 |
| C09 | Choose memory date | composer | today; past; future; cancel picker | unit | P1 |
| C10 | Dedication to partner vs you | composer | audience label; partner cannot see a “you” memory? check contract | unit | P1 |
| C11 | Cancel with a draft | composer | keep draft; discard; confirm | unit | P0 |
| C12 | Background during composition | composer | draft survives; state on return | native | P1 |
| C13 | Save offline | composer | pending, not saved; draft survives | manual + unit | P0 |
| C14 | Failed send | composer | failed distinct from pending/saved; retry/edit/remove | unit | P0 |
| C15 | Retry multiple times | composer | one memory only; no duplicate attachments | integration | P0 |
| C16 | Close and reopen a pending save | composer/feed | pending survives or is truthfully gone; no false success | native | P0 |
| C17 | Storage full during upload | composer | explicit limit; draft preserved; path to free space | manual | P0 |
| C18 | Save with no content | composer | Keep disabled or clear validation | unit | P1 |
| C19 | Overlong title/body | composer | validation before request; server also rejects | unit + integration | P1 |
| C20 | Duplicate create with same clientId | integration | one row; same result returned | integration | P0 |
| C21 | Navigate away during save | composer | no lost draft; no phantom saved row | native | P1 |
| C22 | Legacy capture deep link | `/moment/trace?capture=photo\|note\|voice` | forwards to composer; never auto-saves | unit | P2 |

## D. Reading, editing, deleting memories

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| D01 | Feed order and paging | Memories | oldest first; keyset cursor; no duplicates on merge | integration | P0 |
| D02 | Feed/gallery toggle | Memories | state preserved; gallery scroll position | unit | P2 |
| D03 | Open a note | memory detail | body; author; date; edit controls only for author | unit | P0 |
| D04 | Open a photo | detail/viewer | zoom/pan; close; gallery paging | native | P1 |
| D05 | Play a video | detail | play/pause; end; background; audio routing | native | P1 |
| D06 | Play/scrub a voice note | detail | play/pause; scrub; silent switch; route change | native | P1 |
| D07 | Unread landing / seen cursor | Memories | first unread lands; marking read persists | unit | P1 |
| D08 | Resurface notification | notification | opens the right memory; no duplicate notification | native | P1 |
| D09 | On-this-day memory | Us / resurface | same month/day, at least one year earlier; no random fallback | unit | P1 |
| D10 | Open a chapter | chapter list/detail | range membership; oldest-first; empty/not enough | unit + integration | P1 |
| D11 | Future-dated memory | archive/Us | remains in archive; does not light today’s sky | unit | P1 |
| D12 | Goal memory | archive/chapter | remains in archive; excluded from chapter eligibility | unit | P1 |
| D13 | Delete own memory | detail | confirm/cancel; tombstone; media quota release | integration | P0 |
| D14 | Partner tries to edit/delete | detail | no controls; API 403 even if forced | integration | P0 |
| D15 | Edit own memory | detail/edit | title/body/date/media; save failure keeps values | unit + integration | P0 |
| D16 | Stale edit | two devices | 409; no silent overwrite; reload path | integration | P0 |
| D17 | Delete while partner is reading | two devices | partner refresh removes it; open detail becomes unavailable | integration | P0 |
| D18 | Failed feed read | Memories | error with retry; not an empty archive | unit | P0 |
| D19 | Empty vs loading vs failed | Memories | three distinct states | unit | P0 |
| D20 | Load earlier history | Us/story feed | explicit request; does not page whole archive silently | unit | P1 |
| D21 | Open memory from Us | Us story | same detail as Memories; no duplicate editing state | unit | P1 |
| D22 | Respond to a memory | detail | word/tap; author attribution; remove own response | unit + integration | P1 |
| D23 | Deleted memory deep link | any | 404/removed state; no stale body | integration | P1 |

## E. Us: sky and sky history

The current `together.tsx` route is the photo sky. It does not mount the relationship-home sections described in some product documents (current activity, on-this-night, constellations, story feed). Those are listed under “not present in this route” below.

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| E01 | First visit to Us | `/together` | sky renders; empty prompt; loading | unit | P1 |
| E02 | Add sky photos | Us → Choose photos | library selection; cancel; permission denied | native | P1 |
| E03 | Encryption/sharing copy before choosing | Us | visible before action; no false E2EE claim | unit | P1 |
| E04 | Manage sky photos | Us | select/remove; local copy behavior explained | native | P1 |
| E05 | Pan/zoom/double-tap sky | Us | gesture bounds; reduced motion; no accidental open | native | P2 |
| E06 | Sky info sheet | Us | explains sky vs dated memories; dismiss | unit | P1 |
| E07 | Partner sees shared sky | two devices | photos appear; approval/recovery requirements explained | native | P1 |
| E08 | Us vs Memories expectation | manual | person can predict where a photo appears | manual | P1 |
| E09 | Revisit sky | Us | Plus gate copy; active Plus state; no false lock | unit + native | P1 |
| E10 | Sky history | Us → Revisit | Plus-gated; date controls; empty/loaded; no invented history | native | P2 |
| E11 | Empty sky | Us | explicit “Choose photos” action; not a dead end | unit | P1 |
| E12 | Sky read failure | Us | error + retry; not “no photos” | native | P1 |
| E13 | Delete a sky photo | Us | removes from sky; does not delete camera-roll original | manual | P1 |
| E14 | No relationship start date | Us history | history unavailable; editor offered; no invented date | unit | P1 |

## F. Plans, calendar, goals, someday

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| F01 | Month view | Plans | loaded month; empty month; loading; failed read | unit | P0 |
| F02 | Year view | Plans → year | month cells; empty; tap month | unit | P1 |
| F03 | Day timeline | Plans day | events; all-day; overlaps; empty | unit | P1 |
| F04 | Create event | new event | title/date/time; save; cancel | unit | P1 |
| F05 | All-day event | new event | time fields hidden; day layout correct | unit | P1 |
| F06 | Recurring event | new/edit | recurrence rule; occurrence display; edit scope | unit | P1 |
| F07 | Event reminders | new/edit | offsets; permission denied; duplicate scheduling | native | P1 |
| F08 | Partner sees event | two devices | same date/time; actor name; refresh | integration | P1 |
| F09 | Edit own event | edit | changes persist; partner sees | integration | P1 |
| F10 | Edit partner’s event | edit | ownership rule; controls hidden/refused | integration | P1 |
| F11 | Delete event | edit/detail | confirm/cancel; partner sees removal | integration | P1 |
| F12 | Empty month | Plans | explicit empty status only after a successful read | unit | P0 |
| F13 | Failed month read | Plans | retry; no false empty | unit | P0 |
| F14 | Rapid month paging | Plans | stale reads cannot replace selected month | integration | P0 |
| F15 | Save then switch month | Plans | late save refresh stays on committed month | integration | P0 |
| F16 | Create goal | goal-new | title/date; appears in Plans; not as a memory | unit | P1 |
| F17 | Goal → chapter eligibility | chapter | goals excluded | unit | P1 |
| F18 | Add someday item | Plans → Someday | title/note/category; empty; checked state | unit | P1 |
| F19 | Check/undo someday | Someday | checkedByRole; open first order | integration | P1 |
| F20 | Reminder permission denied | event | event still saves; reminder path explains | native | P1 |

## G. Lists / Ours

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| G01 | Ours hub | Ours | lists preview; sky/partner entries; empty | unit | P1 |
| G02 | Empty lists | Ours | explicit action to create first list | unit | P1 |
| G03 | Create list | new list | name/description; cancel; save failure | unit | P1 |
| G04 | Open list | list detail | items; empty; loading; failed read | unit | P1 |
| G05 | Add item | item/new | title/note/link; quick add; cancel | unit | P1 |
| G06 | Edit item | item detail | change; stale write; partner edit | integration | P1 |
| G07 | Remove item | item detail | confirm/cancel; partner sees | integration | P1 |
| G08 | Edit/remove list | list edit | rename; remove confirm/cancel; partner sees | integration | P1 |
| G09 | Concurrent list/item edits | two devices | conflict surfaced; no silent overwrite | integration | P1 |
| G10 | Collection link | item link | open external link; invalid link; no data leak | unit | P2 |
| G11 | Empty vs failed lists | Ours/list | distinct states; retry | unit | P1 |
| G12 | Days together | Ours | day one counts; DST/leap; missing/future date invents nothing | unit | P1 |

## H. Account, relationship, partner portrait

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| H01 | Account overview | Account | name/email/space; sections load | unit | P1 |
| H02 | Switch theme | Account | After Hours/Beach; light/dark; persists | unit | P2 |
| H03 | Open/replay guide | Account → How to use Aoi | opens; dismiss; “start in Memories” | unit | P1 |
| H04 | Edit relationship as creator | Account → Edit relationship | name/partner/date; save; cancel | unit | P1 |
| H05 | Edit relationship as partner | Account | edit row absent; values readable | unit | P0 |
| H06 | Export data | Account → Export | share success; cancel; failure; media errors counted | native | P1 |
| H07 | Local photo copies | Account | list; empty; device-only explanation | native | P2 |
| H08 | Devices | Account → Devices | pending request; approve; mismatch; no request | native | P0 |
| H09 | Recovery phrase | Account | reveal; confirm; copy blocked?; screenshot warning | native | P0 |
| H10 | Restore album | Account → Restore | valid phrase; invalid; interrupted; retry | native | P0 |
| H11 | Paywall | Account → Unlock Plus | Free; Plus; purchase; cancel; restore | native | P1 |
| H12 | Legal links | Account/paywall | open privacy/terms/support; failure visible | native | P2 |
| H13 | Sign out | Account | confirm? immediate; unregister push | unit + native | P0 |
| H14 | Leave space | Account | confirm/cancel; failure; last-member archive | integration | P0 |
| H15 | Delete account | Account | confirm/cancel; failure; partner retains history | integration | P0 |
| H16 | Partner portrait | Space → Partner | empty; add detail; category; remove; failed read | unit | P1 |
| H17 | Partner detail privacy | Partner | only shared portrait; private details not leaked | unit | P1 |

## I. Encrypted album, devices, recovery

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| I01 | First album open | Album | create archive; show phrase; confirm; restart | native | P0 |
| I02 | Phrase confirmation mismatch | enroll | cannot continue; retry; no archive mutation | native | P0 |
| I03 | Partner requests enrollment | devices | request appears; approve with matching fingerprint | native | P0 |
| I04 | Fingerprint mismatch | devices | approval refused; request not accepted | native | P0 |
| I05 | Partner accepts approval | enroll | enters archive; can read/decrypt | native | P0 |
| I06 | Unauthorized device | album | 404/401; no keys; no media | integration | P0 |
| I07 | Publish encrypted media | album | reservation; ciphertext PUT; complete; partner reads | integration | P0 |
| I08 | Restart persistence | album | archive/media survive server restart | integration | P0 |
| I09 | Signed tombstone deletion | album | both archives empty; restart keeps deleted | integration | P0 |
| I10 | Recovery phrase restore | restore | valid; invalid; typed phrase retained on failure | native | P0 |
| I11 | Interrupted restore | restore | retry; no half-created identity presented as complete | native | P0 |
| I12 | Lost phrase and no trusted device | restore | truthful dead end; no fake support path | manual | P0 |
| I13 | Old device after replacement | devices | access status truthful; removal explicit | native | P0 |
| I14 | Local photo copies | local photos | device-only; not shared archive; delete local copy | native | P2 |
| I15 | check-photo deep link | legacy | redirects to Us; recognition inactive | unit | P2 |

## J. Subscription boundaries

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| J01 | Paywall Free | paywall | price/limits; legal links; restore | unit | P1 |
| J02 | Paywall Plus | paywall | active state; manage link; no purchase CTA | unit | P1 |
| J03 | Purchase success | paywall | store sheet; server entitlement; partner sees | native | P1 |
| J04 | Purchase cancel | paywall | no charge; state unchanged | native | P1 |
| J05 | Purchase failure | paywall | error; retry; no false Plus | native | P1 |
| J06 | Restore purchases | paywall | restores; no entitlement; failure | native | P1 |
| J07 | Partner entitlement | two devices | same Space row; same limits | integration | P1 |
| J08 | Expiry/revocation | server | read-time expiry; partner loses Plus | integration | P1 |
| J09 | Storage limit reached | upload | explicit limit; current usage; path to free space | integration + native | P0 |
| J10 | Delete media frees quota | upload | quota drops immediately in read model | integration | P1 |
| J12 | PDF keepsake gate | chapter | server-authoritative Plus gate | native | P2 |

## K. Questions, notifications, squeezes

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| K01 | Weekly question | Question | loaded; no question; failed read/retry | unit | P1 |
| K02 | Answer question | Question | save; update; too long; partner sees | integration | P1 |
| K03 | Partner answer visibility | Question | both answers; attribution; no overwrite | integration | P1 |
| K04 | Push permission | launch/settings | allow; deny; blocked; later enable | native | P1 |
| K05 | Register/unregister token | sign-in/out | token registered; unregister on signout; failure swallowed | native | P1 |
| K06 | Partner joined notification | push | opens space; no false membership | native | P1 |
| K07 | Memory/resurface notification | push | opens correct memory; read state | native | P1 |
| K08 | Squeeze | global overlay | send; receive; offline; duplicate | native | P1 |

## L. Cross-cutting and failure states

| ID | Flow | Entry | Branches that matter | Layer | P |
|---|---|---|---|---|---|
| L01 | Offline launch | launch | signed-in data cached; reads fail visibly | native | P0 |
| L02 | API 401/expired token | any | refresh or sign out; no stale data | integration | P0 |
| L03 | API 403 | any | ownership/space rule explained | integration | P0 |
| L04 | API 429 | any | retry/error; no data loss | integration | P1 |
| L05 | API 500 | any | retry; no false success | integration | P1 |
| L06 | Account switch during request | any | late response ignored | unit | P0 |
| L07 | Partner leaves while open | any | refresh; no access; history retained for them | manual + integration | P0 |
| L08 | Space archived while open | any | space disappears; safe route | manual | P1 |
| L09 | Large text | all | controls reachable; no clipped actions | native | P1 |
| L10 | VoiceOver | all | roles/names/state; modal focus | native | P1 |
| L11 | Reduced motion | all | animation gated | native | P2 |
| L12 | Dark/light | all | contrast; surfaces | native | P1 |
| L13 | Small screen 320×568 | setup/guide/composer | scroll; footer reachable; no overlap | native | P1 |
| L14 | iOS/Android sheets/keyboard | all | reopen during dismissal; keyboard avoidance | native | P1 |
| L15 | Timezone/DST change | relationship/plans | date-only fields stay stable | unit | P1 |
| L16 | Deep link to missing/deleted content | any | safe 404; no crash | manual | P2 |

## Features with no current user route

These are implemented in shared models or features but are not exposed as authenticated screens in this checkout. Do not test them as user flows until a route exists:

- Weekly letters: shared API/model exists, but there is no authenticated letters route in `app/(app)`. Do not test a letter UI until one is mounted.
- Us relationship-home sections: current activity, on-this-night, constellations, and the story feed are described in `docs/product/relationship-home-and-archive.md`, but the current `together.tsx` only renders the sky. Chapter detail is reachable from Memories month rows.
- Notification settings: no dedicated screen; permission is handled by the OS and push context.
- Profile and Settings routes redirect to Account.
- Legacy face recognition/check-photo: redirects to Us; recognition is inactive.

## Suggested first flows to test

If the goal is to find product problems rather than raise test counts, start here:

1. **B20** creator saves before partner joins, partner sees it with correct author.
2. **B19** partner joins while creator waits, foreground refresh without push.
3. **C13–C16** offline/pending/failed/retry, one memory only.
4. **D15–D17** edit conflict and delete-while-reading.
5. **E08** sky photo vs dated memory expectation (manual).
6. **F12–F15** empty month, failed read, rapid paging, late save.
7. **H05** partner relationship edit affordance (now fixed; verify creator still edits).
8. **H14–H15** leave and delete-account consequences for the partner.
9. **I10–I13** recovery phrase, interrupted restore, old device access.
10. **J09** storage limit reached and quota release.
