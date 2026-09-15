# Aoi: complete product and design implementation plan

Updated: 2026-09-05. Execution has NOT started. This is the canonical continuation plan for the current conversation.

## 1. Objective and authority

Turn Aoi into a beautiful, dependable private keepsake for two that can earn payment and ship on iOS and Android. Beauty, onboarding, and navigation are first-class deliverables, not a final coat of polish. Preserve useful existing implementation; do not rebuild wholesale.

User instructions:
- Assess first, remove what is not salvageable, finish the product rather than merely adding payments.
- Propose a beautiful UI and clean organization; onboarding currently feels messy.
- New assets are welcome. Existing assets do not constrain the design.
- **Codex is the brain; Muse is the implementation worker.** Use Pi with `opencode-go/muse-spark-1.3-contributor`, high or xhigh reasoning. Do not silently substitute models or implement the app directly with Codex.
- Latest request is to SAVE A CONCRETE PLAN. Do not interpret this document as a request to deploy or begin a broad rewrite during the planning turn.

Editorial Paper is the recommended working direction, not a user-approved final visual specification. User has not explicitly selected among visual directions. Begin the next implementation session by refining the proposed direction against real screen evidence and the asset exploration below. Do not repeat the whole initial assessment.

## 2. Resume here

1. Read this file, project `AGENTS.md`, and the reviewed design brief linked below.
2. Verify workspace state and running processes. Previously `/home/ekasc/Projects/ts/aoi` had **no Git metadata**. Do not reset, initialize over an existing repository, or delete `.stversions`/generated data casually. Establish a scoped recoverable source snapshot before edits if Git remains unavailable; exclude credentials, dependencies, caches and generated native folders.
3. Use `pi --help` and `pi --list-models muse` to verify the requested model is still callable. Never print auth credentials.
4. Start P0 below. Shape contracts and tests as Codex, assign bounded files to Muse, inspect actual diffs and evidence, return defects to Muse, then update the ledger.
5. Keep progress in this file's ledger and append specific verification evidence. Do not mark a phase done solely on worker claims.

### Documents and artifacts

- `docs/product/2026-09-05-product-assessment.md`: original source findings and product recommendation.
- `docs/product/2026-09-05-design-direction.md`: reviewed design direction, superseded where this plan is more specific.
- `docs/product/2026-09-05-muse-design-proposal.md`: raw worker critique with a warning header. NOT a specification; contains rejected claims.
- `artifacts/design-review/proposal.html`: Muse-built four-screen concept and palette switcher.
- `artifacts/design-review/proposal-desktop.png`, `proposal-mobile.png`: inspected renderings of that concept.
- Root `PLAN.md`, `README.md`, `docs/MONETIZATION.md`, and marketing documents contain stale/conflicting claims; do not use them as authoritative completion evidence.

### Current verified baseline

- App implementation unchanged by this conversation; only proposal/assessment artifacts authored.
- `pnpm run typecheck` passed.
- `node_modules/.bin/vitest run` passed: 88 files, 1,005 tests, 124.59 s. Includes mocked app tests and API/shared/Worker tests, not real native E2E.
- `node_modules/.bin/eslint app components constants features hooks packages tests --quiet` failed: two conditional-hook errors at `features/moments/moments-context.tsx:380`.
- Broad `eslint .`: 67 errors/129 warnings, partly historical `.stversions` files. Do not mistake historic snapshots for active app defects.
- Dev server was already running on port 8081 (`expo start --tunnel`). Preserve it unless a restart is necessary and coordinated.
- Live web preview blocked by importing native-only `react-native/Libraries/Utilities/codegenNativeCommands` through `react-native-maps`. Expo error page itself raised `Cannot read properties of undefined (reading 'map')`; browser body stayed blank. This does not prove native failure.
- Browser MCP could not find `/opt/google/chrome/chrome`. Working fallback: Playwright at `/home/ekasc/.npm/_npx/9833c18b2d85bc59/node_modules/playwright`, Chromium `/home/ekasc/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`. Verify paths before use; do not change global browser config unnecessarily.
- Concept checked at 1500×1080 and 390×844: no horizontal overflow, palette controls work, font loads. Body contrast 16.32:1, secondary 6.87:1, moss button 8.62:1, clay on paper 7.13:1. Current teal button actually passes 7.27:1; raw Muse criticism was incorrect.
- Native builds, device tests, store setup, production state, customer demand and pricing remain unverified.

## 3. Product and navigation contract

Promise: **Save the little things now; enjoy your story together later.** No streaks, relationship scores, obligatory daily actions, or fake sample partner content in production empty states.

| Destination | Contents | Creation action |
| --- | --- | --- |
| Story | Memories; chronological browsing; photo wall; voices; resurfacing; monthly/anniversary chapters | Photo / Note / Voice only |
| Together | Letters shelf; optional weekly reflection; small secondary squeeze action | Write letter within Letters; answer within reflection |
| Plans | Important dates; simple calendar and agenda; proposals; Someday; future goals | Add plan / suggest time locally |
| Space, via avatar | Invite/waiting status; relationship details; appearance; notification preferences; Plus; export; support/legal; sign-out/leave/delete | Contextual settings actions |

Keep three tabs, not five. Five tabs are not inherently bad; Profile/Settings duplication and equal weighting of unrelated features are the actual problems here. No generic six-feature create sheet. Move Someday only to Plans. Story may include already-opened letters by explicit choice, but Together remains the canonical Letters destination; never leak sealed content into filters, previews or recaps.

Remove location/maps from v1 navigation AND permission/background registration. Retain data safely while retiring functionality. Defer local-only Little things unless it is given durable sync. Exclude splash lab and unused concepts from release. Retire legacy Node/Postgres only after proving no active entry point, migration or deployment depends on it.

## 4. Design and asset contract

Working direction: **Editorial Paper**. Warm ivory, quiet moss controls, small clay authorship marks, expressive editorial headings, system-like readable body, photos given generous space. Avoid repetitive raised cards, nested cards, pill overload, center timeline rails, technical metadata typography and generic feature menus.

Starting tokens: paper `#FCF9F2`, ink `#1E1B16`, secondary `#5E564A`, border `#E3D8C3`, subtle surface `#F3ECDD`, primary `#334E45`, clay `#8A3E28`. These are starting tokens, not a ban on improving the visual direction. Compose a proper dark palette and semantic error/success/focus/disabled states; validate all combinations.

Typography: investigate licensed editorial serif + readable sans. Existing New York is a prototype reference, NOT evidence of redistribution rights. Keep only if license permits shipping on both platforms. System body fonts are a viable default; replacement fonts require provenance. Rough scale: 30–34 screen headings, 21–24 content headings, 16 body, 13–14 supporting copy. Respect dynamic type; no arbitrary scaling caps.

### Asset work, not limited to current files

Create `docs/design/asset-manifest.md` listing each asset's purpose, source/creator, license, source file, exports, light/dark behavior, dimensions and byte size. Use `assets/brand/`, `assets/illustrations/`, `assets/letters/`, `assets/chapters/` for deliverables. Keep editable originals outside the app bundle when appropriate.

| ID | Deliverable | Placement and criteria |
| --- | --- | --- |
| A1 | Two distinct original welcome illustration studies, select one coherent family | Express two people keeping a shared story; no generic SaaS people, hearts everywhere, or dependence on stock couple photography |
| A2 | First-memory empty-state illustration | One inviting composition plus a real action; not a wall of onboarding tasks |
| A3 | Waiting/invitation illustration | Calm, no implication that the partner must respond urgently; user can proceed solo |
| A4 | Envelope states: sealed, available to open, opened | Accessible state text alongside artwork; opening motion and reduced-motion alternative; no body revealed early |
| A5 | Monthly and anniversary chapter cover templates | Attractive with zero/one/many photos; export-safe font licensing; readable dates and names |
| A6 | Refined wordmark/icon/splash exploration if current branding fails the new direction | Validate small app-icon sizes and light/dark display; no prolonged launch animation |
| A7 | Curated licensed demo photos for prototypes/store screenshots | Diverse, consistent art direction, explicit sample-data separation; never inserted as real account memories |
| A8 | Font pair and motion specification | License files, native rendering samples, keyboard/dynamic-type layouts, durations and reduced-motion states |

Do not use the existing landing poster as the finished asset strategy. Original illustration for welcome/empty states, tactile artwork for letters, users' own photos for Story. Avoid decorative grain/blur on every surface. If raster generation/editing is required, Codex may invoke the image-generation capability as art director; Muse integrates assets and implements screens. Use the available image-generation skill/tool, not procedural raster drawing as a substitute.

## 5. Execution phases and acceptance criteria

Each phase: Codex shapes bounded work → Muse implements → focused checks → Codex reviews correctness, product quality and security → Muse repairs → record evidence. Route any additional review delegation explicitly; never silently replace the requested implementation worker.

### P0 — Baseline and immediate protection

Files: `features/moments/moments-context.tsx`, `packages/api/src/programs/cron.ts`, relevant cron tests, `features/subscription/*`, `components/setup/use-setup-flow.ts`, map route/components, test/lint config only as needed.

- [ ] Re-establish source snapshot/diff baseline and runnable checks.
- [ ] Repair conditional hooks using provider/component separation, not suppressed lint rules.
- [ ] Make orphan cleanup abort if known-key lookup fails. Never translate uncertainty into deletion. Audit variant publication races, minimum-age safety, pagination/cursor progress, and retry after R2 deletion failure. Preserve rows until cleanup is confirmed.
- [ ] Regression tests: DB lookup failure deletes zero objects; in-flight variants survive; failed object deletion retries; legitimate aged orphan cleanup still works.
- [ ] Missing store config must return unavailable, never simulated success in a release. Explicit dev-only simulation if retained; no cross-platform key fallback. Clear purchase identity on account change/logout and prevent stale entitlement flashes.
- [ ] Remove photo-before-space ordering conflict. Current active interview does not expose its photo picker, so distinguish latent code defect from observed user path. New onboarding attaches media only after successful space creation.
- [ ] Isolate native map imports by platform or remove retired entry points, so web can render for design inspection. Do not imply web preview replaces native validation.

Gate: targeted regressions, typecheck, current-source lint pass; real web screenshots possible or remaining blocker documented precisely. No remote deployment or destructive data operation.

### P1 — Visual foundations and asset exploration

Files: `constants/theme*.ts`, `constants/typography.ts`, `hooks/use-aoi-fonts.ts`, `components/themed-*`, `components/ui/*`, new asset directories and `docs/design/*`.

- [ ] Muse produces two original illustration directions within the proposed brand, and screens using selected asset family. Review welcome, empty Story, populated Story, Letters, Plans, Space and dark-mode samples together.
- [ ] Establish asset manifest/licensing, font decision and export pipeline.
- [ ] Implement semantic tokens, typography, surfaces, buttons, fields, separators, sheets and icon conventions. Do not blanket-reformat unrelated files.
- [ ] Native controls remain native; iOS blur reserved for suitable chrome, Android uses appropriate solid surfaces/elevation. No fake platform glass requirement.
- [ ] Cover default/pressed/focus/disabled/loading/error states. 44+ logical-unit touch targets and readable text contrast. Dynamic type, small phones, keyboard, dark mode and reduced motion are acceptance cases.

Gate: coherent reviewed screen set including empty/loaded/dark states and actual new assets. HTML sheet is a direction reference, not pixel-exact native specification.

### P2 — Navigation and feature reduction

Files: `app/(app)/(tabs)/_layout.tsx`, tab screens, `app/(app)/_layout.tsx`, `app/_layout.tsx`, relevant providers, profile/settings routes.

- [ ] Story / Together / Plans tabs; consolidate Profile + Settings into Space behind avatar with accessible navigation.
- [ ] Define a typed route map. Update all links, notification destinations and back navigation; retain safe redirects for old links before removing obsolete route files.
- [ ] Contextual composers; no duplicate Someday or photo-wall destination.
- [ ] Disable location entries, tasks, subscriptions and permission prompts together. Remove map dependencies only after caller audit; preserve existing data and explain any retirement policy.
- [ ] Exclude development routes/concepts; remove unused UI after callers migrate. Defer Little things without silently deleting saved notes.

Gate: every retained feature has one clear home; no dead links, duplicate account menus, surprise permissions or inaccessible navigation. Auth providers and lifecycle cleanup still run correctly.

### P3 — Onboarding replacement

Files: `app/(public)/*`, `app/(auth)/*`, `components/setup/*`, `features/session/*`, `features/space/*`, shared space contracts and Worker spaces domain/routes where required.

Creator flow: **Welcome → sign-in → one short setup → Story.** Prefill own name; partner name optional; default space name; relationship date truly optional. Do not fabricate today's anniversary to satisfy an old schema. Update client/shared/DB contracts with migration if needed. Theme and historical import live in Space afterward.

- [ ] Welcome shows emotional asset + “Create our space” and “I have an invitation”; no payment or theme gate.
- [ ] Setup has only own name and optional partner name. Clear primary action. Back preserves signed-in session rather than signing out.
- [ ] Idempotent create and resumable navigation after interrupted requests; no duplicate spaces on retry.
- [ ] Story starts with first-memory invitation and small invite action. Saving first memory offers native share; invite-first and skip remain available.
- [ ] Join retains invitation across auth/relaunch, validates after auth, confirms intended space safely, then opens actual content. No duplicate creator questionnaire.
- [ ] Handle invalid/expired/full/revoked invite, already-member, already-in-another-space, offline, cancellation and simultaneous last-slot joins. Do not disclose sensitive content through invite previews.
- [ ] Make theme selection, cover photo, since-date and “add a past memory” optional settings tasks. Separate onboarding state from decorative preferences.

Gate: two fresh users create/join without admin homework; solo creator proceeds; permissions requested only when needed; keyboard/dynamic-type layouts tested; API enforces two-member concurrency invariant.

### P4 — Story, capture and retrieval

Files: timeline screen, `components/moments/*`, `components/media/*`, `features/moments/*`, `features/media/*`, Worker moments/media and shared contracts.

- [ ] Remove taxonomy-heavy first form. Photo/Note/Voice opens relevant compact editor; optional title/date/details progressively disclosed. Letters and plans remain contextual.
- [ ] Persist appropriate drafts and retry identifiers; protect private local content; clear inaccessible account/space caches on lifecycle changes.
- [ ] Upload states distinguish uploading, processing, ready and failed. Preserve draft on failure, support retry/cancel, avoid duplicate creates and show safe errors. Image previews/auth headers and voice playback work on both platforms.
- [ ] Replace raised-card/central-rail repetition with editorial month groupings, generous media, restrained bylines and readable notes. Avoid a hero block above every list.
- [ ] Incremental cursor pagination; do not fetch the whole archive on every foreground refresh. Keep selected filters and scroll position stable while partner updates arrive.
- [ ] Wall/voice views inside Story, with retrieval for older months and a simple search/filter path. Define API indexing/range queries rather than client-only full-history search.
- [ ] Real empty/loading/error/offline states. Do not promise full offline sync until an outbox/conflict model is implemented and verified; at minimum preserve drafts and clearly indicate unsent changes.
- [ ] Ownership actions, deletion confirmation and partner refresh remain consistent.

Gate: 1, 50 and 1,000-memory representative datasets; interrupted uploads and relaunch; two-account edit/delete/refresh; permission denial; no raw EXIF/location leakage in served images; bounded list loading.

### P5 — Together and Plans

Files: Together/Plans tabs, letters/question/someday/proposals/calendar features, matching domains and components.

- [ ] Together has visually distinct letter shelf and optional reflection, not a menu of equal rows. One small squeeze affordance; no pressure/status metrics.
- [ ] Letter states: draft, sealed, ready, opened, error. Server owns reveal time and recipient authorization. Preview, notification, search, export and chapter paths cannot leak sealed body. Date/timezone and clock manipulation tests.
- [ ] Implement envelope assets and restrained opening motion with instant/crossfade alternative. Existing empty shelf offers writing a first letter.
- [ ] Weekly answers reveal according to agreed rules; retain history after week rollover. If added to Story, do so as an explicit shared outcome and do not duplicate content per refresh.
- [ ] Plans combines agenda/month, proposals, Someday and goals. Month cells use dots with overflow indication rather than tiny titles; selected agenda inline. Important dates and recurrence remain accurate.
- [ ] Proposals display clear pending/accepted/declined/expired state; Someday can become a dated plan explicitly. No automatic unwanted conversion of plans to memories.
- [ ] Reminder opt-in and timezone/DST/recurrence tests; accessible day labels carry information dots cannot.

Gate: empty/mature visual review; letter privacy/time boundary tests; recurrence/proposal state tests; no duplication of navigation or entities. Multiple letters remain part of eventual Plus scope: earlier brief's “second sealed-letter mechanics out of scope” does not override P8.

### P6 — The paid-quality keepsake

New proposed modules: `features/chapters/`, `components/chapters/`, chapter route(s), `packages/shared/src/chapter.ts`, Worker chapter domain/routes if server generation required. Shape exact schema before Muse edits.

- [ ] Monthly and anniversary chapters from authorized real memories; no invented text or AI relationship interpretation.
- [ ] One dependable editorial template with A5 cover system, photo layouts, dates, notes and voice references; handle sparse months gracefully and avoid empty automated notifications.
- [ ] Preview looks good before upsell. Define preview versus saved/exported premium artifact explicitly.
- [ ] Designed PDF/image export, distinct from free raw account export. Fonts embedded/licensed; escaped user text; signed short-lived downloads; no public media URLs.
- [ ] Generation jobs idempotent and versioned; failed jobs retry; deletion invalidates stale artifacts; completion and access checked server-side.
- [ ] Validate long names, non-Latin scripts, long notes, missing media, many photos, timezone boundaries, and offline download interruptions.

Gate: actual readable export inspected, not just generation success. Sparse and mature chapters look deliberately designed. No sealed letters or inaccessible former-partner data included.

### P7 — Trust, Space, export and separation

Files: new Space screens, session/space/client cache layers, Worker auth/spaces/media/cron, shared contracts, migrations, legal/support pages.

Codex must write a lifecycle matrix before implementation: active → left/archived → deleted, with author, partner and later-partner access for memories/media/letters/plans/exports. Recommended invariant: an old shared space is never repurposed for a new partner; new pairing gets a new space. Clarify any archive promises rather than retaining contradictory behavior.

- [ ] Free raw JSON + media export with ownership/membership checks, safe filenames, bounded jobs and expiring downloads. No subscription required to retrieve own data.
- [ ] Account deletion matches disclosed policy: revoke sessions/push/sharing immediately, schedule durable purge of appropriate authored content and media, retry storage failures, handle backups with disclosed retention.
- [ ] Leave/archive consequences are clear and tested; partner-authored data not unexpectedly deleted; no recycled invite grants old content to a replacement partner.
- [ ] Reauthentication for destructive actions where appropriate; actual typed confirmation if promised; revoke old invite links; cleanup local data after sign-out/deletion/leave.
- [ ] Space contains appearance, relationship details, optional since-date, notification controls, subscription management, export, support, legal, leave/delete.
- [ ] Public privacy policy, terms, support route and deletion-request path; truthful encryption/retention language. Never claim E2EE based on reserved schema fields.
- [ ] Backup/restore procedure and recovery rehearsal, private logs and operational alerting for failed jobs.

Gate: lifecycle matrix enforced end to end for two users plus attempted new partner; export works free; deletions survive worker/R2 failures; screen copy matches backend exactly.

### P8 — Honest monetization

Files: `features/subscription/*`, paywall and Space, new shared entitlement contract, Worker billing domain/webhook/routes and D1 migration, media quotas and letter limits.

Working offer, requires validation: free shared core + limited media; one Plus plan per couple, monthly and annual. `$4.99/month` / `$39.99/year` are test hypotheses, not approved production price points. No lifetime cloud promise. Free read/export/delete retained after expiry. Plus: larger media allowance, multiple future letters, designed keepsakes/export. Do not charge merely to open a gallery.

- [ ] Codex defines buyer/account/space entitlement ownership and behavior for separation, refund, transfer, two simultaneous subscribers, grace/billing retry and account deletion.
- [ ] RevenueCat webhook verification, event deduplication/order handling, authoritative reconciliation, stable account identity; frontend never grants server access.
- [ ] Backend checks limits and storage reservations atomically, including pending uploads and concurrent partner requests. Reject without losing draft.
- [ ] Real store offers/localized price and billing period; exact package selection, no fallback to unrelated product. Loading/unavailable/cancel/pending/failure/success distinct.
- [ ] Restore and manage subscriptions; logout/account-switch identity isolation; cross-platform partner benefit without giving access to a different space.
- [ ] Clear benefits tied to actual implementation; privacy/terms links and accurate renewal disclosure. No paywall in onboarding; present after value or an understandable limit.
- [ ] Cost model based on observed bytes, processing/requests/egress, retention, store fees, refunds and support. Set explicit free/paid storage limits from this model before public sale.

Gate: sandbox purchase/restore/renew/expire/refund on each platform, both partners receive correct benefits, account-switch/leave fails closed; backend enforces quotas; displayed promise matches shipped functionality.

### P9 — Consolidation, marketing and release

- [ ] Rewrite README, root PLAN, monetization runbook and marketing around actual Worker/D1 architecture and retained product; mark historical docs clearly rather than silently mixing them.
- [ ] Remove unsupported E2EE/offline/archive/lifetime/refund promises and placeholder testimonials. Generate store screenshots with licensed demo content and new assets.
- [ ] Retire unused legacy API/scripts/dependencies after import/deployment audit and retaining migration history. Do not delete D1 migrations or user data as “cleanup.”
- [ ] CI: lint current source, typecheck app/API/shared, meaningful unit/domain/Worker tests, migration verification, non-publishing build checks. Exclude historical snapshots intentionally, not errors wholesale.
- [ ] Real iOS + Android device acceptance, light/dark, small phone/tablet, screen reader, dynamic type, reduced motion, keyboard, camera/microphone/photos/push denial, background/foreground, slow/offline network.
- [ ] Test two physical/device accounts against real dev backend, not only stub mode. Capture evidence of auth → create → invite → memory/media → letter → plan → chapter → export → billing → leave/delete.
- [ ] Measure startup, scrolling and media memory on representative devices; resolve UX jank before calling polish complete.
- [ ] Optional 10–15-couple four-week beta to observe joining, both contributing, voluntary revisits and actual purchases. No sending invitations/messages without explicit authorization. Content-free analytics with privacy disclosure if added.
- [ ] Validate current Apple/Google policy, bundle IDs, signing, age/content classification, data safety/privacy disclosures, background permissions, reviewer access and support links.
- [ ] Native/EAS builds, store submission and publication require the applicable explicit user authorization. Do not boot simulators or run native builds merely to inspect this plan. Credentials/store enrollment are external prerequisites, not reasons to stop local work.

Gate: all product/privacy/native/store gates evidenced; no claim that unit tests prove shipment readiness. Report remaining external approvals honestly.

## 6. Pi worker protocol

Use the actual Pi CLI, not OpenCode CLI, because the user explicitly chose Pi. Tested command pattern:

```sh
pi --provider opencode-go \
  --model muse-spark-1.3-contributor \
  --thinking xhigh \
  --no-extensions --no-skills --no-prompt-templates \
  --tools read,write,edit \
  --no-session -p @/absolute/path/to/scoped-task.md
```

Run with workspace cwd. Grant `bash` only when needed for scoped checks. Include applicable AGENTS/skill requirements in the task. Don't rely on hidden extension routing. Use unique task/result paths and retain useful evidence under docs, not only `/tmp`.

Every task brief must state: objective, owned files, interfaces/invariants, expected states and edge cases, prohibited changes, tests, and required summary of files changed/checks/blockers. Tell Muse it shares the workspace and must preserve others' edits. Keep slices small enough for complete review. Codex reviews source diff and browser/device result; defects go back to Muse. No silent model substitution if provider fails.

## 7. Ledger

| Work | Status | Next concrete action |
| --- | --- | --- |
| Assessment | Done, source-based | Use existing findings; verify touched code before repair |
| Muse proposal/concept | Done, reviewed concept only | Asset studies and actual native screen review remain |
| Canonical execution plan | Saved | Resume P0 |
| P0 baseline/protection | Not started | Snapshot, cron failure regression, lint fix, web import isolation |
| P1 identity/assets/system | Not started | Muse asset/screen studies + licensing manifest |
| P2 navigation | Not started | Typed route/provider migration map |
| P3 onboarding | Not started | Optional-date/name schema and auth/invite state machine |
| P4 Story/capture | Not started | Upload lifecycle + incremental retrieval design |
| P5 Together/Plans | Not started | Letter privacy state matrix + agenda composition |
| P6 chapters | Not started | Real export template and generation contract |
| P7 trust/lifecycle | Not started | Ownership/retention matrix before implementation |
| P8 monetization | Not started | Buyer-space lifecycle + cost/limit contract |
| P9 ship | Not started | Full real-device evidence after preceding phases |

Suggested dependencies: P0 first; P1 before broad screen rewrites; P2 before P3–P5; P4 before P6; P7 lifecycle decisions before P6 export and P8 entitlements; P9 after product gates. Move lifecycle contract design earlier while Muse tackles UI, but do not concurrently edit shared modules without explicit ownership.

## 8. Definition of complete

A couple can sign in on different platforms, begin without setup homework, contribute and find memories, enjoy letters and a tangible keepsake, pay once for shared benefits, restore after changing phones, and leave/export/delete with honest predictable consequences. Screens are beautiful with their actual content AND with no content. Assets are original or licensed. Failures preserve user work and private data. All meaningful gates have current evidence; store actions remain explicit.
