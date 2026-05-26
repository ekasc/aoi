# Aoi — Glossary of Terms

## Core Entities

### Moment
A timestamped, intentionally captured relationship artifact. Has a type (note, milestone, date, goal, media), a title, optional body/attachments, and an author. Shown in the timeline, feeds the recap/resurface engine. A calendar event must be explicitly promoted to become a moment.

### Calendar Event
A scheduling block with start/end time, duration, label, and optional reminder. Author and actor (you/partner) tracked independently. Exists in the calendar grid. Most events are individual scheduling decisions, not relationship artifacts. Can be promoted to a moment, at which point it becomes a moment while remaining a calendar event.

### Space
The shared container for exactly two users. Holds all moments, calendar events, media, and preferences. Created by one partner, joined by the other via invite code.

## Relationships

### Moment vs Calendar Event
Separate entities. A calendar event is not a subtype of moment.
- **Promotion:** Manual only — user taps "promote to timeline" on an event. No auto-promotion based on labels.
- **Linking:** Bidirectional sync. Editing the event's title/time/description updates the promoted moment. Editing the moment updates the event. The two records share canonical data.
- **Unlinking:** A promoted moment can be unlinked from its source event, becoming an independent moment. The event continues to exist independently.

### Space Membership
Exactly two active members at any time. Roles are `you` and `partner` — assigned at join time based on who created vs who joined. No hierarchy, but visual distinction in the UI.

### Notifications
- New moment from partner: push notification.
- New calendar event from partner: push notification.
- Calendar reminder (if the event's creator set one): push notification at configured time.
- Recap ready: push notification monthly/yearly/anniversary.
- NSFW content: notification shows "Partner added a moment" with generic preview. No text preview or content hint. Thumbnail is blurred on the notification if media is attached.

### Space Lifecycle

**Archiving** (default on relationship end):
- Space becomes read-only. No new moments, events, or media.
- Encrypted data becomes locked — neither partner can access encrypted content. Prevents blackmail or weaponization of shared history.
- Unencrypted data (timestamps, counts, metadata) remains visible.
- Archived spaces can be restored if both partners agree (future feature).

**Deletion** (partner-initiated):
- When a partner deletes, ALL their authored content is permanently removed: moments, media (from R2), calendar events, voice notes.
- The other partner's authored content is preserved until they delete as well.
- The space remains accessible to the remaining partner in a degraded state (only their content visible).
- When both partners have deleted or the last partner deletes, the space is fully purged.

**Data Ownership:**
- Every moment/event/media record is attributed to a specific author.
- No shared-write entities — each record has a single owner.
- Deletion is hard-delete (not soft-delete) for authored content. Soft-delete for shared-space metadata.
- R2 media objects are deleted synchronously with the owning moment/record.

## Encryption Tiers

### Platform Backup
Key stored in expo-secure-store with iCloud/Google backup enabled. Survives device loss. Default tier.

### Client-Only
Key stored locally, cloud backup disabled. Partner's device is the sole recovery path. User explicitly warned about data loss risk.

### Recovery Phrase
BIP39-style mnemonic derived from the space secret. Optional add-on to either tier. Recovers keys independently of any device or cloud account.
