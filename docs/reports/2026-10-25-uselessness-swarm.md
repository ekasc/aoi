# Uselessness swarm — 2026-10-25

Local OASIS run against Aoi at `048f7838`. Model: **DeepSeek v4.1 Flash only**. No Zep, no MiroFish server, no other model, no production data.

The prompt was deliberately blunt: walk the surfaces you actually used, ask **“Why does this even exist?”**, name what breaks if it is removed, and name the one thing you would keep. No redesign proposals.

## Population and run

12 fictional personas in 6 couples, two couples per tier:

| Tier | Couples | Personas |
| --- | --- | --- |
| Normal users | `couple-01`, `couple-04` | Alice/Bob, Grace/Hiro |
| Frontend developers | `couple-10`, `couple-11` | Nadia/Theo, Jules/Mina |
| Weirdly super critical | `couple-12`, `couple-13` | Vera/Wolf, Iris/Oren |

Six groups, one round, **36 conversations**, **57 substantive comments**. Evidence: `tools/mirofish-lab/runs/oasis-2026-10-25T07-46-14-379Z/`. The pipeline extracted 63 scenarios, but its templates are about flows and security; the removal signal lives in the raw comments.

## Headline

The swarm did not find a warehouse of dead features. It found two different things:

1. **Real ceremony**: confirmations, duplicate invitation surfaces, a permanent help panel, and one genuinely dead legacy route.
2. **Invisible value**: recovery, device trust, pending saves, author labels, the invite code, and the account identity all read as “useless” to someone who has never needed them.

If you delete everything the normal tier called useless, you remove the recovery phrase, device revocation, pending saves, and the account line that prevents joining the wrong space. That is the central finding.

## Consensus removals

These recur across tiers and are supported by current source.

### 1. The post-join confirmation beat

`components/setup/onboarding-wizard.tsx:464-480`, `components/home/sky-welcome.tsx:73`

The joiner sees “You’re in. [Partner] is already here” on the setup sheet, then the sky welcome says “[Partner] is already here” again. The space is the confirmation. The post-create beat is different: it carries the invite code, so it must stay.

**Verdict:** remove or condense the joined beat. Keep the created beat.

> “If I’m in the space, the space is the confirmation. A toast that says ‘You have joined the space’ over a screen that is already the space is the app narrating itself.” — Nadia, frontend

### 2. Three invitation surfaces for one string

`app/(app)/account.tsx:367`, `app/(app)/(tabs)/(memories)/index.tsx:1346`, `components/home/sky-welcome.tsx`

Three entry points present the same code: the Account section and the inline empty-state invitation both use `PartnerInvitation`; the post-create beat uses `SkyWelcome`. Their headings and copy differ, and the post-create surface has a real job. The other two repeat it.

**Verdict:** keep one invitation component and one canonical action set. Keep the code and the share sheet; delete duplicate headings and copy.

> “Invite code panel, plus a separate invite-by-link panel, plus a share row — same intent, three labels, three layouts. Pick one surface and one verb: Invite.” — Jules, frontend

### 3. The permanent help panel

`app/(app)/(tabs)/together.tsx:182-188`

The help panel explains gestures and repeats the Us-versus-Memories distinction. It is a second UI explaining the first; the failure copy lives in the inline discovery hint, not in the panel.

**Verdict:** remove the permanent panel. Move the gesture instructions to first use or the empty sky, and move failure copy to the add-photo action.

> “A second UI explaining the first UI. If the empty states were actually designed, this panel would be redundant prose to maintain forever.” — Iris, critical

### 4. Feed and gallery as two full presentations

`app/(app)/(tabs)/(memories)/index.tsx`

The feed and gallery share one data set but each carries its own empty state, failed state, accessibility path, and scroll behavior. The gallery’s only unique contribution is layout.

**Verdict:** product decision, not an automatic deletion. Either make the gallery a genuinely different lens or keep one presentation. Do not keep two half-maintained ones by default.

> “Two surfaces over the same items means two empty states, two error states, two sets of accessibility paths.” — Wolf, critical

### 5. The legacy verify-code route

`app/(auth)/verify-code.tsx`

The screen says “Auth moved” and offers two links. Nothing in the app links to it; it exists as a route and a layout branch. It is a dead end kept alive by the router.

**Verdict:** remove the route and its layout branch, or redirect it to sign-in. `profile.tsx` and `settings.tsx` are different: they are cheap compatibility redirects for old deep links, not user-facing clutter.

### 6. Success copy that carries no count or next action

`components/space/partner-invitation.tsx:118-134`, `app/(app)/(tabs)/(memories)/index.tsx:1382-1387`

“Invite code copied” and “Kept in your story” are not automatically useless; they confirm an action. But several personas pointed at the same pattern: a success line that adds no count, no destination, and no next step, while the row or button already says it. Audit these one by one rather than deleting all success copy.

**Verdict:** remove only the duplicate; keep the confirmation that names the destination or the failure.

## Do not remove — the tier traps

These were called useless most often by normal users, but the other tiers defended them or the source shows they are load-bearing.

| Thing | Why normal users wanted it gone | Why it stays |
| --- | --- | --- |
| Recovery phrase and phrase check | “I never go looking for it.” | It is the only way back into the archive. The check catches a paper-copy mistake before a wipe; the current screen requires an exact match, not a bypass. |
| Trust codes | “Nobody has ever asked me to compare one.” | They are the out-of-band device check. The code is shown during enrollment and approval; removing it turns a deliberate trust decision into a silent one. |
| Device list | “A list I cannot act on.” | It now has a signed revoke action and a root warning. That critique was true before the fix; it is not true now. |
| Invite code | “I shared the link, so why is there a number?” | The link can fail to preview, be stripped by a chat client, or be read aloud. The code is the fallback and the accessible path. |
| Pending rows, retry, edit | “I never saw one.” | They are the offline ledger. The normal tier never hit the failure; the critical and frontend tiers relied on exactly this state. |
| Author labels | “There are only two of us.” | The partner label is how the reader knows who wrote a memory. The own label can be compressed; the partner label cannot. |
| Photo sky | “It is decoration.” | It is the product’s relationship home, not a list skin. The right fix is a list-first/accessibility path and contrast, not deleting the sky. |
| Account line | “It tells me a name I already know.” | It is the guard against joining under the wrong Google account. Keep it, but put it next to the join action and say which space is being joined. |
| Storage text and manage subscription | “I never read it.” | The text states the quota; the link is the only route to cancel. The normal tier would remove the only place a paying subscriber can manage the plan. |

> “The recovery phrase, the phrase check, and the trust codes — pure chore, and I’d never go looking for them.” — Alice, normal

> “The device list with revoke. It’s the only surface in the whole flow that tells me the truth about who has access.” — Vera, critical

That pair is the whole tension. The same screen is a chore to one tier and the product to another.

## False positives, checked against source

The personas often described a generic app rather than this one. These should not drive removals:

- **“The create/join fork appeared after I opened the invite link.”** The flow starts on the join step when an invite code is present (`invited ? 'join' : 'welcome'`). If a real user sees the fork after a link, that is a bug in the link handoff, not proof the fork is useless.
- **“The invite code is hidden behind a reveal tap / has a badge.”** The current invitation surface shows the code and a Copy button. There is no reveal step and no pending badge.
- **“Signing out asks for confirmation.”** Setup sign-out is a text link; Account sign-out is a button. The confirmation sheets are for leaving a space and deleting an account, which are destructive.
- **“The animated storage bar / fake progress.”** There is no graphical storage meter and no progress bar in restore. Account and paywall show one sentence of used/limit bytes. The personas animated a component that does not exist.
- **“The phrase check lets you proceed on a mismatch.”** The check requires both sampled words to match exactly; a mismatch sets an error and does not confirm.
- **“The device list has no revoke.”** It does now. The old critique is obsolete.
- **“The sky is announced by VoiceOver on every feed open.”** The sky layer is marked `accessible={false}` / hidden from the accessibility tree in the current screen. The low-vision concern is real for contrast and gesture alternatives, but not for an unlabelled sky being announced.
- **“Every empty state is a headline with no action.”** The current Memories empty state has a primary action; the gallery empty state has “Choose photos for your sky”; the first-page dedication has compose/skip/invite. Specific empty states may still be weak, but the blanket claim is false.

## Tier portraits

**Normal users** judge by their own path. They open a link, save a photo, and look for the preview. Anything they have not needed is “decoration,” including recovery, trust codes, the account line, and the history control. Their strongest real contribution is the demand for **one honest preview and one obvious next step**. Their weakest is proposing to delete the safety rails.

**Frontend developers** separate state from decoration. They keep pending rows, retry/edit, and author labels; they remove duplicate headings, disabled-looking controls, and confirmations that repeat a state. Their best line is the test to apply to every candidate:

> “If removing it breaks nothing, it was never load-bearing — it was just loud.” — Mina

**Weirdly super critical users** remove ceremony and demand that every status be true. They keep the recovery phrase screen, the destructive warning, and the device list with revoke; they remove fake progress, duplicate warnings, and unexplained icons. Their best line is the distinction between a status and a performance:

> “A spinner is not a status.” — Wolf

## Recommended removal order

1. Remove or condense the post-join confirmation; keep the post-create code beat.
2. Consolidate the invitation surfaces; keep the code, share, and copy.
3. Move the help panel’s useful copy to first use and the add-photo failure; delete the permanent panel.
4. Decide whether the gallery earns a second presentation; do not keep two default states by accident.
5. Remove the dead `verify-code` route or redirect it.
6. Audit success copy for duplicates that carry no count, destination, or next action.
7. Keep recovery, trust codes, device revoke, pending saves, the invite code, author labels, the sky, the account line, and the storage/manage-subscription pair. Improve their presentation instead of deleting them.

## Limits

- 6 couples, 12 personas, 1 round, 57 comments. This is a directional swarm, not a representative sample.
- No device or simulator. No native VoiceOver or Dynamic Type run.
- The personas are fictional and often describe an imagined version of the app. Every candidate above was checked against source before being marked real; the false positives are listed explicitly.
- The pipeline’s 63 extracted scenarios are flow/security templates, not a removal score. The raw comments are the evidence.
- No app code was changed by this swarm. The only harness change was the `--focus useless` prompt set.

## Fixes applied after the swarm

| Candidate | Status | What changed |
| --- | --- | --- |
| Post-join confirmation | Fixed | The joined door on the setup sheet was removed; the sky welcome is the one confirmation, and the handoff still leaves on the next layout pass. The post-create code beat is untouched. |
| Three invitation surfaces | Fixed | The inline invitation under the first-page dedication was removed, along with the now-unused `inline` variant of `PartnerInvitation`. Account keeps the canonical invitation surface; post-create keeps the code beat. |
| Permanent help panel | Fixed | The help panel and its header control were removed. Gesture guidance now sits in the empty sky, and “Manage photos” is available there and in the history panel; Account also still links to local photo copies. |
| Feed versus gallery | Decided and clarified | The gallery is kept as the media-only lens and renamed **Media** with a hint that it shows photos, videos and voice notes. It is no longer presented as a second generic “Gallery.” |
| Legacy verify-code route | Fixed | `app/(auth)/verify-code.tsx` and its layout branch were removed. |
| Duplicate success copy | Fixed | The delivered pending row no longer repeats “Kept in your story” beneath its “Sent” status. Confirmations that name a destination or a failure remain. |

Verification after the fixes: 2,586 unit tests and 609 integration tests passed (3 skipped); typecheck, lint (0 errors), and the static accessibility audit (0 findings) passed.
