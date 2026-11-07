# Aoi — Product

Aoi is a private relationship app for exactly two people. It is a shared home for memories, plans, lists, and a photo sky. It is deliberately calm: no feeds, no streaks, no badges, no public sharing, no engagement metrics, and no AI in the product.

The product promise is: **keep the little things now; enjoy the story later.**

## People

Couples who want a private place for what they intentionally share. It is used on evenings at home, while planning dates, and while remembering milestones. One person often plans; the other often reads. Asymmetry is normal, and the app should never make the reader feel behind.

## Principles

1. **Private by default, joyful in expression.** Every interaction reinforces that this is a safe, personal space.
2. **Moments deserve ceremony.** Keeping a memory should feel like journaling, not filling a form.
3. **Two people, not one.** Authorship is always visible and warm: `you` vs `partner`, accent vs partner accent. No hierarchy.
4. **Calm over engagement.** Nothing demands attention. No streaks, scores, urgency, or guilt copy.
5. **Native-first.** Use platform affordances: native tabs, sheets, glass, SF-style icons, haptics. The app should feel at home on the device.
6. **Honest limits.** Empty, loading, failed, and filtered states are distinct. Do not seed content to hide an empty state. Do not sell features that do not exist.

## Brand and visual system

Current direction is editorial and warm, not corporate and not “dark-mode techy.”

- **Themes:** two presets, both with light and dark modes.
  - **After Hours** (default): frosted wine, soft rose light, cool pink accents.
  - **Beach:** bright cyan water, vivid aqua, warm sand.
- **Typography:** the production decision is the platform system sans, with hierarchy carried by size and weight. No bundled font binaries. New York, Trebuchet, and the unidentified mono were retired because their licences do not permit app redistribution.
- **Color:** semantic tokens only (`textPrimary`, `textSecondary`, `primary`, `partnerAccent`, `danger`, `success`, `warning`, surface/border roles). Both presets are contrast-tested in both modes; body text holds at least 4.5:1.
- **Spacing:** `Spacing[0|4|8|12|16|24|32|40|56]` only.
- **Radii and motion:** `Radii` and `Motion` in `constants/theme.ts`. Motion is short (160/240/360 ms), with reduced-motion support.
- **Primitives:** `Surface`, `Button`, `IconButton`, `Divider`, `ThemedText`, `ThemedView`, `ScreenHeader`, `GlassSurface`, `FrostedBackdrop`, `NavRow`, `SectionHeading`, `ActionSheet`, `NativeSheet`, `PaperTextInput`.
- **No emoji as UI**, no hearts in navigation, no gradients-as-decoration, no generic SaaS card walls. Photos and words carry the page.

## Destinations

### Memories

The complete chronological archive, oldest first.

- Composer accepts a note, photo, video, voice recording, or goal. Up to 10 attachments.
- Pending, failed, and saved sends are distinct. Failed work can be retried, edited, or removed without duplicating.
- Feed and gallery views, month headers, chapter detail, photo viewer, voice playback, video playback.
- First-page dedication, seen cursor, silent resurfacing notification.
- Chapter keepsake export (PDF) gated on the server-confirmed Plus entitlement.
- Edit and delete are author-only. Delete is a tombstone, never a hard delete of the shared record.

### Us

A full-screen photo sky built from the pair's shared album.

- Photos are chosen by the user, prepared on device, encrypted locally, and uploaded to the space.
- Pinch to zoom, drag to traverse, double-tap to focus, two-finger tap to step back.
- A focused star shows its album-added date and opens the photo.
- **Sky History** rewinds the sky to a past month. It is a Plus benefit; on Free the control stays visible and locked.
- Empty state offers the picker; failures keep a retry. Album devices, enrollment, recovery phrase, and restore live under Account.
- No automatic camera-roll scanning and no face recognition. Old recognition deep links redirect to Us.

### Plans

The shared planning surface.

- Month grid with day drill-in, agenda, and a year view.
- Events have start/end, label, actor, all-day and together flags, optional location text, and reminder offsets.
- Weekly recurrence expands into 13 concrete instances. Instances are ordinary events; there are no series edits.
- Reminders are silent local notifications on the device that saved the event.
- **Someday** is a shared soft-check-off list (place, food, film, other) inside Plans.
- **Goals** are moments of type `goal`; they render in Plans and never become memories automatically.
- Anniversaries and monthiversaries are derived from the relationship start date.

### Lists

The pair's own catalogues.

- A list is a name and a colour from a fixed palette. No emoji.
- An item has a title, optional note, optional link or place, optional cover photo, status (`want`, `doing`, `done`), and a score out of ten.
- Lists and items are shared by the space. Either member can add, edit, reorder, or remove.

### Account

Everything account-level, opened from the avatar on Lists.

- Appearance, How to use Aoi, relationship details and start date, partner invitation.
- Data export: raw archive, never gated by Plus.
- Shared album: local photo copies, devices, recovery phrase, restore.
- Plus status and purchase/restore entry.
- Sessions: sign out, sign out everywhere.
- Leave space, delete account, privacy and terms.

Sessions stay signed in until explicit sign-out, account deletion, or remote revocation through "sign out everywhere." Inactivity and old expiry metadata do not revoke an existing session. Network errors, failed renewal, and failed storage updates retain saved credentials. A locked keychain delays startup and retries after unlock. Unknown tokens and deleted accounts still cannot authenticate. A copied session credential remains valid until revocation; time alone no longer limits it.

A known space survives failed or empty background reads and app restarts. Cached membership does not grant server access. Only a confirmed leave clears the local space; a failed leave keeps it. Sign-out never changes membership, so signing back in restores the same space.

"Sign out everywhere" revokes all sessions and push registrations for the account, without affecting the partner or shared space. The client clears its local session only after confirmation. Failed global sign-out and account deletion requests keep the session and report an error.

Offline sign-out reports failure if saved credentials cannot be deleted. A confirmed server revocation still ends local access if keychain cleanup fails. Late JSON and media responses cannot cross an account switch, while renewal within the same session keeps existing requests valid. A stale leave or push cleanup cannot overwrite a newer account's state.

Single-device logout also sends the attempted push token, so the server can remove that device's registration atomically with its session if the earlier unregister failed. Other devices and accounts keep their registrations. Offline sign-out cannot guarantee immediate remote revocation or cessation of push delivery while the server is unreachable.

### Shared screens

- Memory detail and edit.
- Responses on a memory: a tap, a word, a photo, or a voice note, attributed to its author.
- Partner portrait: small private details (`favorite`, `habit`, `quirk`, `words`, `other`). These are per-user, not shared space content.
- Weekly question: one handcrafted question per ISO week. Each partner answers privately; answers reveal only when both have answered.
- Paywall: live store plans, purchase, restore, pending activation.

## Data model

| Entity | Ownership | Notes |
| --- | --- | --- |
| Space | shared | Exactly two active members; one active membership per user; one permanent partner slot. |
| Moment | shared | Types `note`, `milestone`, `date`, `goal`, `media`, `trace`. Body, occurrence date, optional target date, attachments, author. |
| Moment response | shared | Belongs to one memory; kinds `tap`, `word`, `photo`, `voice`. |
| Collection / item | shared | Lists and their entries. |
| Calendar event | shared | Separate from moments. Weekly recurrence, reminders, all-day, together, location text. |
| Someday item | shared | Soft check-off and undo, no hard delete route. |
| Weekly answer | per member, per week | Revealed to the partner only when both answered. |
| Partner detail | per user | Private to the author. |
| Album media | shared | Encrypted photo with a signed manifest and tombstone. |
| Plus entitlement | per space | Authoritative in the backend; RevenueCat is the purchase/restore surface. |

Authorship is viewer-relative: the API returns `authorRole: "you"` for the caller and `"partner"` for the other member.

## Free and Plus

Free is a complete couples app. Both members share one entitlement.

| Benefit | Free | Plus |
| --- | --- | --- |
| Shared media storage | 250 MiB per space | 5 GiB per space |
| PDF chapter keepsakes | Upgrade required | Included |
| Us and the live photo sky | Included | Included |
| Sky History (rewind the sky) | Locked, visible | Included |
| Memories, gallery, chapters, everyday resurfacing | Included | Included |
| Plans, lists, responses, weekly question, partner details | Included | Included |
| Data export and privacy controls | Included | Included |

Storage is never described as unlimited. Reading older memories is never cut off on Free. Recognition is not a paid benefit. The backend space entitlement grants protected benefits; client store state alone never does.

## Not in the product

These are retired, deferred, or explicitly out of scope. Do not build them back in without a product decision.

- **Location sharing / maps.** No consent flow, no partner map, no background location. Legacy backend routes may remain, but there is no app surface.
- **Letters / time capsule.** Removed; the table was dropped.
- **Proposals (“how about Saturday?”).** Removed.
- **Squeeze.** Removed.
- **Face recognition and camera-roll discovery.** Inactive research only. No provider is mounted in the authenticated tree.
- **Memory wall / standalone photo grid.** Removed; photos live in Memories and chapters.
- **Recaps / Wrapped, richer chapters, capsules, sky history projections.** Future ideas, not current paid benefits.
- **Groups, multi-space, or more than two members.** The product is couples-only.
- **End-to-end encryption for moments.** Album photos are client-encrypted; moment text and media are server-visible. Do not claim otherwise.
- **Web checkout / Stripe.** Purchases are RevenueCat in-app on iOS and Android. Web can view the paywall but cannot buy.

## Current state and known gaps

- **Album encryption is real** for chosen sky photos: device-side keys, signed manifests, tombstones, recovery phrase, device enrollment/approval. Moment content is not encrypted.
- **Push is best-effort.** Remaining kinds are partner joined, moment changes, and calendar events. Location kinds survive only in legacy backend code with no app surface. An offline device misses a push with no replay.
- **Reminders are device-scoped.** A partner-created event does not schedule a reminder on the other device.
- **Weekly recurrence is bounded** to 13 instances and has no series operations.
- **Sky History is derived** from album `addedAt` dates. It does not version or restore a historical sky state.
- **The legacy Node/Postgres backend remains on disk** as a migration reference. The Worker is the production backend.
- **No EAS Update or CI-driven store release.** `eas.json` has development/preview/production profiles; store submission still needs a device and configured services.
- **Recognition is inactive.** Face models and evaluations are not shipped.
