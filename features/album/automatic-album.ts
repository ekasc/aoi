import { randomUUID } from 'expo-crypto';

import { cosineSimilarity, DEFAULT_MATCH_THRESHOLD, PAIR_MATCH_POLICY_VERSION, type Faceprint } from '@/features/album/face-pipeline';
import { FACE_DETECTION_POLICY_VERSION, SFACE_MODEL_ID, normalizeFaceEmbedding } from '@/features/album/face-recognition-engine';
import type { createLocalFaceRecognition } from '@/features/album/local-face-recognition';
import { scanPairPhoto } from '@/features/album/scan-pair-photo';
import type { SkyPhotoRepository } from '@/features/album/sky-photo-repository';

export type RecognitionEngine = ReturnType<typeof createLocalFaceRecognition>;
export type AlbumEnrollment = { modelId: string; referenceId?: string; prints: [Faceprint, Faceprint] };
export type LibraryPhoto = { id: string; version: string };
export type ScanDecisions = Record<string, { version: string; photoIds: string[] }>;
export type AutomaticAlbumStorage = {
  loadEnrollment: () => Promise<AlbumEnrollment | null>;
  saveEnrollment: (enrollment: AlbumEnrollment) => Promise<void>;
  forgetEnrollment: () => Promise<void>;
  loadDecisions: () => Promise<ScanDecisions>;
  saveDecisions: (decisions: ScanDecisions) => Promise<void>;
  loadCheckpoint?: () => Promise<ScanCheckpoint | null>;
  saveCheckpoint?: (checkpoint: ScanCheckpoint) => Promise<void>;
};
export type PhotoLibrary = {
  permission: (request: boolean) => Promise<'full' | 'limited' | 'denied'>;
  page: (after?: string, since?: number) => Promise<{ photos: LibraryPhoto[]; next: string | null; total?: number }>;
  localUri: (id: string) => Promise<string | null>;
  subscribe: (changed: () => void) => () => void;
};
export type ScanProgress = {
  checked: number; added: number; failed: number; visited: number; cached: number; total: number | null;
  unavailableFiles: number; readFailures: number; detectionFailures: number; embeddingFailures: number;
  uncertain: number; noFaces: number; singleFace: number;
};
export function emptyScanProgress(): ScanProgress {
  return { checked: 0, added: 0, failed: 0, visited: 0, cached: 0, total: null, unavailableFiles: 0, readFailures: 0, detectionFailures: 0, embeddingFailures: 0, uncertain: 0, noFaces: 0, singleFace: 0 };
}
export type ScanCheckpoint = { version: string; after: string | null; finished: boolean; progress: ScanProgress };
export type AutoScanResult =
  | { kind: 'complete' | 'partial' | 'queued'; progress: ScanProgress; access: 'full' | 'limited' }
  | { kind: 'cancelled' | 'permission-denied' | 'unavailable' | 'enrollment-required' }
  | { kind: 'failed'; progress: ScanProgress };

export async function enrollSoloFace(engine: RecognitionEngine, uri: string, person: Faceprint['person'], signal: AbortSignal): Promise<Faceprint> {
  if (signal.aborted) throw new Error('Setup cancelled.');
  if (!await engine.isAvailable()) throw new Error('Face recognition is unavailable in this build.');
  if (signal.aborted) throw new Error('Setup cancelled.');
  const faces = await engine.detect(uri);
  if (signal.aborted) throw new Error('Setup cancelled.');
  if (faces.length !== 1) throw new Error('Choose a clear photo with only this person in it.');
  if (!faces[0].landmarks) throw new Error('Choose a clearer, front-facing photo.');
  const embedding = await engine.embed(uri, faces[0]);
  if (signal.aborted) throw new Error('Setup cancelled.');
  return { person, embedding: normalizeFaceEmbedding(embedding) };
}

export function pairEnrollment(you: Faceprint, partner: Faceprint): AlbumEnrollment {
  if (you.person !== 'you' || partner.person !== 'partner') throw new Error('Choose a reference photo for each person.');
  if (cosineSimilarity(you.embedding, partner.embedding) >= 0.72) throw new Error('These references look like the same person. Choose a different photo for each of you.');
  return { modelId: SFACE_MODEL_ID, referenceId: randomUUID(), prints: [you, partner] };
}

/** Decisions are committed only after a match has a durable local copy. */
export async function scanAutomaticAlbum({ engine, enrollment, storage, library, repository, signal, onProgress, onPhotosChanged, since, threshold = DEFAULT_MATCH_THRESHOLD, maxPages = Infinity, maxDurationMs = Infinity, yieldWork = async () => {}, now = Date.now }: {
  engine: RecognitionEngine; enrollment: AlbumEnrollment; storage: AutomaticAlbumStorage;
  threshold?: number;
  library: PhotoLibrary; repository: SkyPhotoRepository; signal: AbortSignal;
  onProgress: (progress: ScanProgress) => void; onPhotosChanged: () => void;
  since?: number;
  maxPages?: number; maxDurationMs?: number; yieldWork?: () => Promise<void>; now?: () => number;
}): Promise<AutoScanResult> {
  let progress = emptyScanProgress();
  const started = now();
  let after: string | undefined;
  let dirty = false;
  try {
    if (signal.aborted) return { kind: 'cancelled' };
    if (enrollment.modelId !== engine.modelId) return { kind: 'enrollment-required' };
    const access = await library.permission(false);
    if (signal.aborted) return { kind: 'cancelled' };
    if (access === 'denied') return { kind: 'permission-denied' };
    const versionPrefix = `${engine.modelId}:${enrollment.referenceId ?? 'legacy'}:${access}:${PAIR_MATCH_POLICY_VERSION}:cutoff:${threshold}:detector:${FACE_DETECTION_POLICY_VERSION}`;
    const checkpointVersion = `${versionPrefix}:since:${since ?? 'all'}`;
    if (!await engine.isAvailable()) return { kind: 'unavailable' };
    const decisions = await storage.loadDecisions();
    const checkpoint = await storage.loadCheckpoint?.();
    if (checkpoint && checkpoint.version === checkpointVersion && !checkpoint.finished) {
      progress = { ...checkpoint.progress }; after = checkpoint.after ?? undefined;
    }
    const persist = async (finished: boolean) => {
      if (dirty) { await storage.saveDecisions(decisions); dirty = false; }
      await storage.saveCheckpoint?.({ version: checkpointVersion, after: after ?? null, finished, progress: { ...progress } });
    };
    onProgress({ ...progress });
    const cursors = new Set<string>();
    let pages = 0;
    do {
      if (signal.aborted) { await persist(false); return { kind: 'cancelled' }; }
      const page = await library.page(after, since);
      if (page.total !== undefined) progress.total = page.total;
      for (const photo of page.photos) {
        if (signal.aborted) { await persist(false); return { kind: 'cancelled' }; }
        if (now() - started >= maxDurationMs) { await persist(false); return { kind: 'queued', progress, access }; }
        const previous = decisions[photo.id];
        // Imported assets stay decided even after edits, so removing a copy is permanent.
        const version = `${versionPrefix}:${photo.version}`;
        progress.visited++;
        const finishPhoto = async (cooldown = true) => { after = photo.id; onProgress({ ...progress }); if (cooldown) await yieldWork(); };
        if (previous && (previous.version === version || previous.photoIds.length > 0)) { progress.cached++; await finishPhoto(false); continue; }
        let uri: string | null;
        try { uri = await library.localUri(photo.id); }
        catch {
          if (signal.aborted) { progress.visited--; await persist(false); return { kind: 'cancelled' }; }
          progress.failed++; progress.readFailures++; await finishPhoto(); continue;
        }
        if (signal.aborted) { progress.visited--; await persist(false); return { kind: 'cancelled' }; }
        if (!uri) { progress.failed++; progress.unavailableFiles++; await finishPhoto(); continue; }
        const result = await scanPairPhoto({ uri, prints: enrollment.prints, pipeline: engine, threshold, signal });
        if (signal.aborted || result.kind === 'cancelled') { progress.visited--; await persist(false); return { kind: 'cancelled' }; }
        if (result.kind === 'unavailable') return { kind: 'unavailable' };
        if (result.kind === 'enrollment-required') return { kind: 'enrollment-required' };
        if (result.kind === 'failed') {
          progress.failed++;
          if (result.stage === 'availability') { await persist(false); return { kind: 'failed', progress }; }
          if (result.stage === 'detection') progress.detectionFailures++; else progress.embeddingFailures++;
          await finishPhoto(); continue;
        }
        if (result.kind === 'no-faces') progress.noFaces++;
        if (result.kind === 'single-face') progress.singleFace++;
        if (result.kind === 'unsure') progress.uncertain++;
        let photoIds: string[] = [];
        if (result.kind === 'pair') {
          const before = new Set((await repository.list()).map((item) => item.id));
          if (signal.aborted) return { kind: 'cancelled' };
          const excludedIds = Object.values(decisions).flatMap((decision) => decision.photoIds);
          const imported = await repository.importPhotos([{ uri }], excludedIds);
          photoIds = imported.filter((item) => !before.has(item.id)).map((item) => item.id);
          // A duplicate is still a matched decision; record a marker to suppress edits/re-adds.
          if (!photoIds.length) photoIds = ['duplicate'];
          progress.added += photoIds[0] === 'duplicate' ? 0 : photoIds.length;
          onPhotosChanged();
        }
        decisions[photo.id] = { version, photoIds };
        dirty = true;
        if (result.kind === 'pair') { await storage.saveDecisions(decisions); dirty = false; }
        progress.checked++;
        await finishPhoto();
      }
      if (!page.next) { after = undefined; break; }
      if (cursors.has(page.next) || (page.photos.length === 0 && after === page.next)) throw new Error('Photo library cursor repeated');
      cursors.add(page.next);
      after = page.next;
      await persist(false);
      pages++;
      if (pages >= maxPages || now() - started >= maxDurationMs) return { kind: 'queued', progress, access };
    } while (true);
    if (progress.total === null) progress.total = progress.visited;
    await persist(true);
    return signal.aborted ? { kind: 'cancelled' } : { kind: progress.failed ? 'partial' : 'complete', progress, access };
  } catch {
    return signal.aborted ? { kind: 'cancelled' } : { kind: 'failed', progress };
  }
}
