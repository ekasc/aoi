# UI/API parity

## Scope

The Cloudflare Worker is the active backend. The legacy Node/Postgres routes and the removed encrypted-album prototype are not part of the current UI.

No deployment, remote migration, credential writes, native builds, commits, or pushes in this pass. Preserve existing working-tree changes and user data.

## Work list

- [x] Read operating principles and trace UI repositories to Worker routes.
- [x] Add shared schemas, D1 persistence, authenticated routes, and client wiring for memory responses.
- [x] Add private user-scoped partner details, including delete and failed-write handling.
- [x] Check media authorization, account deletion, schema generation, and OpenAPI contracts.
- [x] Include responses, private details, and ordered attachment media in raw export.
- [x] Run targeted regressions, full suites, and app/API/shared typechecks.

## Contract decisions

- Memory responses are visible only to active members of the live memory's space. Author identity comes from the session, never the payload. Cross-space and deleted memories return not found.
- Response variants are tap, words, photo, and voice. Photo/voice requests reference authorized media IDs; the server derives protected URLs. Device URIs and arbitrary URLs are not server data.
- Partner details remain private per user, as the current local repository is. The API generates IDs/timestamps; the client changes its list only after writes succeed.
- Empty collections return successful empty arrays. Failed reads remain errors.
- Existing routes cover spaces, memories/attachments/timeline/read state, calendar, proposals, letters, weekly reflections, Someday, location, preferences, milestones, Plus, push, and squeezes. This pass does not imply deployment or a real-phone remote smoke test.

## Verification record

- Final full suite passed with two workers: 2,317 tests across 212 files.
- Scoped lint passed; accessibility audit found zero findings; `git diff --check` passed.
- Browser smoke test opened a memory, submitted words, and confirmed the response rendered. Screenshot inspected directly. This was an isolated dev preview using stub storage, not a deployed API test. The browser session was closed afterward.
- App, Worker API, and shared-package typechecks passed.
- Worker bundle built successfully with `pnpm --filter @aoi/api build:cloudflare`. No deployment ran.
- D1 migrations were executed by the real SQLite test harness. Regenerating the schema reported no further changes. No running local or remote database was migrated.
- HTTP regressions cover authentication, empty reads, response attribution, strict payloads, other-space/other-owner/incomplete/deleted media, archived/deleted memories, revoked membership at write time, private-detail deletion, account deletion, and OpenAPI.
- Client regressions cover media upload before response creation, account/space scope guards, failed writes without ghost rows, safe error propagation, and complete export datasets/media.
- Phone-to-Worker sign-in, two-device media playback, push delivery, and the new private-detail error UI have not been exercised against a deployed backend. The phone remains in stub mode.
- Existing fixture data was not migrated, deleted, or hidden. The removed encrypted-album prototype remains unimplemented server-side.

## Next runtime gate

Apply migration `0010_equal_aaron_stack.sql` to the chosen environment, then run an authenticated two-device smoke test. This requires a separate deployment/migration decision. Raw export uses the bounded, space-scoped response page endpoint rather than one request per memory.
