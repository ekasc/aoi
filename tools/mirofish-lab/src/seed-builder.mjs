import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { labPaths } from './lib/paths.mjs';
import { gitHead, gitIsDirty } from './lib/git.mjs';
import { writeJson } from './lib/io.mjs';

const SEED_VERSION = 'seeds-v1';
const MIROFISH_COMMIT = '7657031ac01184afe2cb220f5ee3545573b5e843';

const SYNTHETIC_NOTICE = `> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.`;

const DOCS = [
  {
    file: '00-product-and-content-model.md',
    title: 'Aoi: product and content model',
    status: 'verified',
    summary: 'What Aoi is, the four destinations, and the two-person space constraint.',
    sources: [
      'PRODUCT.md',
      'docs/product/first-use-acceptance.md',
      'docs/product/relationship-home-and-archive.md',
      'app/(app)/(tabs)/_layout.tsx',
      'packages/shared/src/space.ts',
    ],
    verified: [
      'Aoi is a private space for exactly two people to save memories and make plans together (`docs/product/first-use-acceptance.md`).',
      'The authenticated tab layout exposes Memories, Us, Plans, and Space (`app/(app)/(tabs)/_layout.tsx`). The task brief calls the fourth destination Lists; the checked-in tab is Space, and Plans/Lists content lives behind it.',
      'A relationship space has one creator and at most one active partner. Storage enforces one active membership per user and one active partner per space (`packages/api/src/domains/spaces.ts`, partial unique indexes).',
      'A space is not a group. Invitations admit one partner, and the partner slot never becomes reusable after someone has joined (`joinSpaceProgram`, `packages/api/src/domains/spaces.ts`).',
      'Memory authorship is viewer-relative: the API returns `authorRole: "you"` for the caller and `"partner"` for the other member (`momentToApi`, `packages/api/src/domains/moments.ts`).',
    ],
    intended: [
      'The first useful action is saving one memory, possibly before the partner joins (`docs/product/first-use-acceptance.md`).',
      'Us and Memories are separate destinations with different content: sky photos versus dated memories (`docs/product/relationship-home-and-archive.md`).',
      'Plans and collections are shared planning surfaces; goals do not automatically become memories (`docs/product/relationship-home-and-archive.md`).',
    ],
    unresolved: [
      'The product brief refers to a Lists tab while the checked-in navigation calls the fourth destination Space. This lab models what the source actually exposes and does not assume a Lists route exists.',
      'No source establishes that adding a photo in one destination publishes it to the other.',
    ],
    simulationMaterial: [
      'Fictional couples must be modelled as two accounts in one space, never as a larger group.',
      'A conversation may reveal that someone expects one shared login. That expectation is a hypothesis about confusion, not a product fact.',
    ],
  },
  {
    file: '01-onboarding-and-invitations.md',
    title: 'Onboarding, creating versus joining, and invitations',
    status: 'verified',
    summary: 'How a person creates a space, invites a partner, joins, and what the server treats as membership.',
    sources: [
      'app/(auth)/sign-in.tsx',
      'app/(auth)/space-setup.tsx',
      'components/setup/use-onboarding-flow.ts',
      'components/setup/onboarding-wizard.tsx',
      'components/space/partner-invitation.tsx',
      'packages/api/src/domains/spaces.ts',
      'packages/shared/src/space.ts',
      'docs/product/first-use-acceptance.md',
    ],
    verified: [
      'Sign-in and setup are separate steps. Setup offers explicit create and join choices before the identity form (`app/(auth)/space-setup.tsx`, `components/setup/use-onboarding-flow.ts`).',
      'Creating a space issues a six-character-style invite code through `generateInviteCode`; the server stores a normalized form and a 30-day expiry (`INVITE_TTL_MS`, `packages/api/src/domains/spaces.ts`).',
      'Joining normalizes the entered code, rejects an unknown code as 404, an already-redeemed code as 400, an expired code as 400, the creator joining their own space as 409, and a space whose partner slot is already bound as 403 (`joinSpaceProgram`).',
      'The join write is one D1 batch: guarded invite redemption, partner membership insert, partner-name update, and one-time partner binding. Concurrent redeemers cannot both win (`joinSpaceProgram`).',
      '`partnerJoined` is the reliable membership signal. `inviteCode` is empty when no live unredeemed invite exists, and `inviteExpiresAt` carries the expiry (`spaceSchema`, `loadSpaceWithInvite`).',
      'The invitation sheet regenerates an expired code before sharing and never claims that opening the share sheet means the partner joined (`components/space/partner-invitation.tsx`).',
      'Account and the first-memory prompt are the stable invitation entry points; the sheet reports membership from a server read, including a manual status check (`docs/product/first-use-acceptance.md`, `PartnerInvitation`).',
    ],
    intended: [
      'Sharing an invitation does not connect accounts until the other person signs in with their own account and joins.',
      'A person should understand whether they created a space or joined one, and where to go next while waiting.',
      'An expired displayed code must never be copyable as a valid invitation.',
    ],
    unresolved: [
      'Source does not show a user-facing explanation of the permanent partner binding after a partner leaves. The invitation control remains reachable while `partnerJoined` is false.',
      'No source establishes how quickly a partner-status refresh is expected to appear on a second phone without push.',
    ],
    simulationMaterial: [
      'A creator shares a code before the partner installs the app and assumes the accounts are already connected.',
      'A joiner reads "create a space" as the normal next step and accidentally creates a second space.',
      'A code is used after 30 days and the person does not know that expiry exists.',
      'One person finishes setup alone; the other person expects to see the same memories immediately after signing in.',
    ],
  },
  {
    file: '02-shared-memories-and-authorship.md',
    title: 'Shared memories, saving, editing, deleting, and authorship',
    status: 'verified',
    summary: 'The memory pipeline, idempotent saves, optimistic concurrency, tombstones, and viewer-relative attribution.',
    sources: [
      'features/moments/moments-context.tsx',
      'features/moments/use-story-feed.ts',
      'features/moments/ownership.ts',
      'features/composer/send-pipeline.ts',
      'features/composer/composer-machine.ts',
      'packages/api/src/domains/moments.ts',
      'packages/shared/src/moment.ts',
      'docs/product/first-use-acceptance.md',
    ],
    verified: [
      'A memory can be a note, photo, video, voice recording, or goal; the shared schema carries type, title, body, occurrence time, optional target time, media, and attachments (`packages/shared/src/moment.ts`).',
      'Creating with a `clientId` is idempotent via a partial unique key on `(space_id, client_id)` for live rows. A replay returns the first result rather than creating a second row (`createMomentProgram`).',
      'Editing and deleting use the observed `updatedAt` as a compare-and-swap. A stale write returns 409 with no activity row; a write scoped to another user is 403; a read of an already-deleted moment is 404 (`packages/api/src/domains/moments.ts`).',
      'Only the author may edit or delete their own memory. The API projects `isOwn` and a viewer-relative `authorName` (`"You"` for the caller, the other member\'s live name otherwise).',
      'Deleting a memory is a tombstone, not a hard delete. Attached media is released only when no other live moment references it, in the same batch as the tombstone (`momentToApi` / delete path).',
      'The composer preserves a failed or pending send and exposes retry/remove controls; a preview being visible is not the same as a completed server write (`features/composer/*`, `docs/product/first-use-acceptance.md`).',
    ],
    intended: [
      'Both people can contribute asynchronously and see the same shared archive after refresh.',
      'A failed save must be distinguishable from a saved one, and retry must not duplicate.',
      'The other person cannot use controls that imply ownership of content they did not write.',
    ],
    unresolved: [
      'The exact user-visible distinction between "pending upload" and "saved memory with media still uploading" is spread across composer and feed state; no single contract string is asserted by the API tests.',
      'No source establishes how a partially uploaded attachment is presented to the partner.',
    ],
    simulationMaterial: [
      'Two people edit the same note at nearly the same time; one expects a merge and the other expects an error.',
      'A photo appears in the feed while its upload is still pending; the author closes the app.',
      'A partner opens a memory while the author deletes it.',
      'A retry is tapped several times after a timeout.',
    ],
  },
  {
    file: '03-us-sky-versus-memories.md',
    title: 'Us photo sky versus the dated memory archive',
    status: 'verified',
    summary: 'Why the sky and Memories are separate, what each action changes, and where ambiguity remains.',
    sources: [
      'app/(app)/(tabs)/together.tsx',
      'components/home/memory-sky.tsx',
      'features/home/day-sky.ts',
      'features/album/sky-photo-repository.ts',
      'features/moments/moments-context.tsx',
      'docs/product/relationship-home-and-archive.md',
    ],
    verified: [
      'Us renders a relationship sky and chronological shared activity from the shared moments store; Memories is the complete reading and media-browsing destination (`docs/product/relationship-home-and-archive.md`).',
      'Sky photos are stored through a separate sky-photo repository and are not dated memories (`features/album/sky-photo-repository.ts`).',
      'A published memory with a future occurrence date remains in the archive but does not light today\'s sky (`docs/product/relationship-home-and-archive.md`).',
      'Us does not add a second notification schedule, and on-this-day is an editorial heading over the existing same-month/day rule.',
      'Free and Plus see the same relationship home; the sky is not an entitlement branch.',
    ],
    intended: [
      'A person should be able to predict where an added photo will appear without knowing the implementation.',
      'Encryption and partner-sharing behavior are visible before choosing sky photos.',
      'The archive and the sky are complementary, not duplicates.',
    ],
    unresolved: [
      'The source intentionally keeps sky photos and dated memories separate; no migration or cross-posting exists. The product documentation calls the relationship between the two paths unresolved for usability.',
      'Whether the sky icon and label are understood is untested.',
    ],
    simulationMaterial: [
      'A person adds a photo in Us and then searches Memories for it.',
      'A person saves a memory with a photo and expects the sky to change immediately.',
      'A person assumes deleting a sky photo deletes the underlying camera-roll copy.',
    ],
  },
  {
    file: '04-offline-save-and-recovery.md',
    title: 'Offline, pending, failed, and retried saves',
    status: 'verified',
    summary: 'What survives a lost connection, how the composer distinguishes states, and what the tests actually prove.',
    sources: [
      'features/composer/send-pipeline.ts',
      'features/composer/composer-machine.ts',
      'features/composer/secure-draft-store.ts',
      'features/moments/moments-context.tsx',
      'tests/unit/hooks/moments-context-remote.test.tsx',
      'tests/unit/composer/composer-send.test.ts',
      'docs/product/first-use-acceptance.md',
    ],
    verified: [
      'The composer has an explicit state machine with draft, preparing, sending, sent, pending, and failed outcomes (`features/composer/composer-machine.ts`).',
      'A send failure preserves the draft and exposes retry/remove rather than silently discarding it (`features/composer/send-pipeline.ts`, composer tests).',
      'The remote moments context merges pages and reconciliation data rather than replacing the local list wholesale (`features/moments/moments-context.tsx`, `tests/unit/hooks/moments-context-remote.test.tsx`).',
      'A create with the same `clientId` is idempotent at the API boundary, which is the server-side guard against duplicate retries (`packages/api/src/domains/moments.ts`).',
      'The first-use checklist requires that offline work is preserved, pending/failed is distinct from saved, and retry produces one memory without duplicates (`docs/product/first-use-acceptance.md`).',
    ],
    intended: [
      'Closing the app or losing signal should not lose a draft that the person believes was kept.',
      'A retry after reconnect should converge to one memory.',
      'A failed read must not be presented as an empty archive.',
    ],
    unresolved: [
      'No test establishes the full two-phone offline loop; most evidence is unit-level with controlled dependencies.',
      'The exact behavior when storage is full during an upload is not asserted end to end.',
    ],
    simulationMaterial: [
      'A person writes offline, sees a pending badge, force-closes the app, and reopens it.',
      'A timeout is followed by three retry taps.',
      'A person switches from Wi-Fi to mobile data while a video upload is in flight.',
    ],
  },
  {
    file: '05-membership-and-accounts.md',
    title: 'Membership, account switching, leaving, and stale responses',
    status: 'verified',
    summary: 'The session and space state layer, including the explicit stale-refresh guard and the gaps around mutations.',
    sources: [
      'features/session/session-context.tsx',
      'features/space/space-context.tsx',
      'features/space/remote-space-repository.ts',
      'packages/api/src/domains/spaces.ts',
      'packages/api/src/domains/auth.ts',
      'tests/unit/space/space-context-refresh.test.tsx',
      'docs/product/first-use-acceptance.md',
    ],
    verified: [
      'Session restoration republishes API tokens before remote reads, so a restored session does not silently make unauthenticated requests (`features/session/session-context.tsx`).',
      'Signing out clears the stored session, tokens, and API token plumbing, and unregisters this device\'s push token while the access token is still valid (`signOut`).',
      'Space hydration, foreground refresh, and the create/join/update/leave/regenerate mutations are scoped to the signed-in user id, so a response from a previous account cannot write the next account\'s space state (`activeUser` guard, `features/space/space-context.tsx`).',
      'A failed manual refresh keeps the current space and rejects to the caller so the UI can report it (`refreshSpace`).',
      'Leaving flips the caller\'s membership to `left`; shared history remains for the other member. The last member leaving archives the space (`leaveSpaceProgram`, `packages/api/src/domains/spaces.ts`).',
      'A space that has ever had a partner is permanently bound to that pairing. A different person cannot join via a fresh or rotated code, and the former partner cannot rejoin (`joinSpaceProgram`).',
    ],
    intended: [
      'Responses from a previous account must never overwrite the newly signed-in account\'s space.',
      'A person should not see another account\'s space, memories, or media after switching accounts.',
      'Leaving should be explained: the partner keeps history, and the leaver loses access.',
    ],
    unresolved: [
      'No source shows how the creator is told that a departed partner\'s slot can never be refilled; the invitation control can still be opened while `partnerJoined` is false.',
      'The UI exposes "Edit relationship" to both members, while `PATCH /v1/spaces/current` is creator-only. The partner receives a generic save failure.',
    ],
    simulationMaterial: [
      'A person begins joining a space, then signs out and signs in with a different account before the request completes.',
      'A partner leaves; the remaining person tries to invite someone new using a freshly generated code.',
      'A joiner opens "Edit relationship", changes the anniversary date, and saves.',
      'A person restores a session after the access token expired.',
    ],
  },
  {
    file: '06-device-authorization-and-recovery.md',
    title: 'Album device authorization, recovery phrases, and restoration',
    status: 'verified',
    summary: 'The encrypted album protocol, enrollment, device trust, recovery, and what remains device-only.',
    sources: [
      'features/album/protocol-client.ts',
      'features/album/protocol-trust.ts',
      'features/album/protocol-recovery.ts',
      'features/album/recovery.ts',
      'app/(app)/album/recovery-phrase.tsx',
      'app/(app)/album/restore.tsx',
      'tests/integration/album-protocol-boundary.test.ts',
      'TESTING.md',
    ],
    verified: [
      'The shared album is a separate encrypted protocol with device identities, signatures, trust anchors, enrollment approval, and tombstones (`features/album/protocol-*.ts`, `TESTING.md`).',
      'Enrollment and recovery are explicit state transitions; the integration boundary suite exercises claim, approve, accept, media publish/retrieve/decrypt, deletion persistence, and recovery with a replacement identity (`tests/integration/album-protocol-boundary.test.ts`).',
      'Restoring from a typed recovery phrase keeps the typed phrase on failure rather than discarding it; the UI has explicit error and retry states (`tests/unit/album/album-error-retry.test.tsx`).',
      'A device that is not enrolled cannot read the archive; the boundary tests assert unauthorized identities receive 404/401.',
      'Recovery phrases and keys are device/secret material. The lab must never generate, copy, or log a real phrase.',
    ],
    intended: [
      'A replacement phone can restore access with the phrase, and an interrupted restore can be retried.',
      'Old or lost devices do not silently retain access after replacement.',
      'The archive survives a device wipe when recovery material is available.',
    ],
    unresolved: [
      'The product path for a person who has neither the phrase nor another trusted device is not established in source.',
      'The E2E recovery flows require an authorized device environment; no simulator or emulator is started by this lab.',
    ],
    simulationMaterial: [
      'A person replaces a phone and restores while on a slow connection.',
      'A person cannot find the paper phrase and asks whether the partner can approve the new phone.',
      'An old phone is sold; the person expects it to lose access immediately.',
    ],
  },
  {
    file: '07-subscription-boundaries.md',
    title: 'Plus entitlement, shared benefits, purchase failure, and storage limits',
    status: 'verified',
    summary: 'What the Space-level entitlement actually grants and what both members observe.',
    sources: [
      'packages/shared/src/plus.ts',
      'packages/api/src/domains/plus.ts',
      'packages/api/src/routes/session-plus.ts',
      'features/subscription/subscription-context.tsx',
      'app/(app)/paywall.tsx',
      'docs/product/relationship-home-and-archive.md',
    ],
    verified: [
      'Plus is Space-level, not per person. One entitlement covers both active members, and both read the same authoritative row (`packages/shared/src/plus.ts`, `packages/api/src/domains/plus.ts`).',
      'Free includes shared notes, the sky, the day count, the relationship home, everyday resurfacing, chronological reading, gallery, existing chapters, plans, responses, and Little things. Privacy and export are not paywalled (`docs/product/relationship-home-and-archive.md`).',
      'The implemented Plus benefits are a media ceiling from 250 MiB to 5 GiB per Space, removal of the one-active-future-letter limit, and PDF chapter keepsakes (`mediaLimitForSpace`, `futureLetterLimitForSpace`).',
      'The backend entitlement row is authoritative. Client RevenueCat state is for purchase/restore UX only and cannot grant features by itself (`packages/shared/src/plus.ts`).',
      'Verified webhook events are deduplicated, stale events cannot regress a newer state, expiry is read-time, and a transfer moves the entitlement without leaving two Spaces Plus (`packages/api/src/domains/plus.ts`).',
      'A grant with no active Space is ignored; an ambiguous or unknown provider identity is ignored; a non-member can never read another Space\'s Plus row (`getSpacePlusProgram`).',
    ],
    intended: [
      'Both members see the same limits and the same entitlement state.',
      'A failed or cancelled purchase changes nothing; the paywall explains renewal and store management.',
      'Storage limits are shown truthfully and are never described as unlimited.',
    ],
    unresolved: [
      'No source establishes how quickly a partner\'s screen reflects a newly purchased entitlement without reopening the app.',
      'The exact UX when a purchase succeeds at the store but the webhook is delayed is not covered by a two-phone test.',
    ],
    simulationMaterial: [
      'One member buys Plus and immediately expects the partner\'s storage ceiling to change.',
      'A purchase sheet is cancelled; the person expects no charge and no change.',
      'Storage is nearly full and one member deletes a memory; the other expects the freed space immediately.',
    ],
  },
];

function readSource(root, relPath) {
  const full = join(root, relPath);
  if (!existsSync(full)) {
    throw new Error(`Seed source is missing: ${relPath}`);
  }
  const bytes = readFileSync(full);
  return {
    path: relPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    lines: bytes.toString('utf8').split('\n').length,
  };
}

function renderDoc(doc, sources) {
  const lines = [];
  lines.push('---');
  lines.push(`seed_version: ${SEED_VERSION}`);
  lines.push(`status: ${doc.status}`);
  lines.push(`aoi_commit: ${sources.aoiCommit}`);
  lines.push('sources:');
  for (const source of doc.sources) {
    const meta = sources.files.find((entry) => entry.path === source);
    lines.push(`  - path: ${source}`);
    lines.push(`    sha256: ${meta.sha256}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(`# ${doc.title}`);
  lines.push('');
  lines.push(SYNTHETIC_NOTICE);
  lines.push('');
  lines.push(`**Purpose.** ${doc.summary}`);
  lines.push('');
  lines.push('## Verified in current source');
  lines.push('');
  for (const item of doc.verified) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Documented intent (not proof of current behavior)');
  lines.push('');
  for (const item of doc.intended) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Unresolved or contradicted');
  lines.push('');
  for (const item of doc.unresolved) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Fictional situation material for MiroFish');
  lines.push('');
  for (const item of doc.simulationMaterial) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Source files');
  lines.push('');
  for (const source of doc.sources) lines.push(`- \`${source}\``);
  lines.push('');
  lines.push(
    'A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.'
  );
  lines.push('');
  return lines.join('\n');
}

export function buildSeeds({ write = true } = {}) {
  const paths = labPaths();
  const aoiCommit = gitHead(paths.repoRoot);
  const dirty = gitIsDirty(paths.repoRoot);
  const allSources = [...new Set(DOCS.flatMap((doc) => doc.sources))];
  const fileMeta = allSources.map((path) => readSource(paths.repoRoot, path));
  const sources = { aoiCommit, files: fileMeta };
  const docs = DOCS.map((doc) => ({
    file: doc.file,
    title: doc.title,
    status: doc.status,
    sources: doc.sources,
    content: renderDoc(doc, sources),
  }));

  const manifest = {
    schemaVersion: 'aoi-mirofish-seeds/1',
    seedVersion: SEED_VERSION,
    aoiCommit,
    aoiDirty: dirty,
    mirofishCommit: MIROFISH_COMMIT,
    generatedAt: new Date().toISOString(),
    docs: docs.map((doc) => ({
      file: `seeds/${doc.file}`,
      title: doc.title,
      status: doc.status,
      sources: doc.sources,
      sha256: createHash('sha256').update(doc.content).digest('hex'),
    })),
  };

  if (write) {
    mkdirSync(paths.seedsDir, { recursive: true });
    for (const doc of docs) {
      writeFileSync(join(paths.seedsDir, doc.file), doc.content, 'utf8');
    }
    writeJson(join(paths.seedsDir, 'manifest.json'), manifest);
  }

  return { manifest, docs, aoiCommit };
}

export function seedPaths() {
  const paths = labPaths();
  return DOCS.map((doc) => ({
    file: doc.file,
    path: join(paths.seedsDir, doc.file),
    title: doc.title,
  }));
}

export { DOCS, SEED_VERSION, MIROFISH_COMMIT };
