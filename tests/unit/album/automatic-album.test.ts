import { describe, expect, it, vi } from 'vitest';

import { enrollSoloFace, pairEnrollment, scanAutomaticAlbum, type AlbumEnrollment, type AutomaticAlbumStorage, type PhotoLibrary, type RecognitionEngine, type ScanDecisions } from '@/features/album/automatic-album';
import { matchByCosine } from '@/features/album/face-pipeline';
import { FACE_DETECTION_POLICY_VERSION, SFACE_MODEL_ID } from '@/features/album/face-recognition-engine';
import { SFACE_TEMPLATE } from '@/features/album/face-alignment';
import { createSkyPhotoRepository, type SkyPhotoRecord } from '@/features/album/sky-photo-repository';

const vector = (index: number) => { const result = new Float32Array(128); result[index] = 1; return result; };
const face = (index: number) => ({ x: index, y: 0, width: 100, height: 100, rollAngle: 0, landmarks: SFACE_TEMPLATE });
const enrollment: AlbumEnrollment = { modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] };

function fixture() {
  let decisions: ScanDecisions = {};
  let records: SkyPhotoRecord[] = [];
  let excluded: string[] = [];
  const files = new Set<string>();
  const engine: RecognitionEngine = {
    modelId: SFACE_MODEL_ID, isAvailable: vi.fn(async () => true),
    detect: vi.fn(async () => [face(0), face(1), face(2)]),
    embed: vi.fn(async (_uri, box) => vector(box.x)), match: matchByCosine, dispose: vi.fn(async () => {}),
  };
  const storage: AutomaticAlbumStorage = {
    loadEnrollment: vi.fn(async () => enrollment), saveEnrollment: vi.fn(async () => {}), forgetEnrollment: vi.fn(async () => {}),
    loadDecisions: vi.fn(async () => structuredClone(decisions)), saveDecisions: vi.fn(async (value) => { decisions = structuredClone(value); }),
  };
  const library: PhotoLibrary = {
    permission: vi.fn(async () => 'full'), page: vi.fn(async () => ({ photos: [{ id: 'a', version: '1' }], next: null })),
    localUri: vi.fn(async () => 'file:///a.jpg'), subscribe: vi.fn(() => () => {}),
  };
  const repository = createSkyPhotoRepository(`auto-${Math.random()}`, {
    read: async () => JSON.stringify(records), write: async (value) => { records = value; },
    importPhoto: async ({ uri }) => { const id = uri.includes('b') ? 'photo-b' : 'photo-a'; files.add(id); return { id, width: 100, height: 100, addedAt: '2026-01-01T00:00:00Z' }; },
    uriFor: async (id) => files.has(id) ? `file:///${id}.jpg` : null,
    removeFile: async (id) => { files.delete(id); }, readExcluded: async () => excluded, writeExcluded: async (value) => { excluded = value; },
  });
  const abort = new AbortController();
  const onProgress = vi.fn(); const onPhotosChanged = vi.fn();
  const run = (threshold?: number) => scanAutomaticAlbum({ engine, enrollment, storage, library, repository, signal: abort.signal, onProgress, onPhotosChanged, threshold });
  return { engine, storage, library, repository, abort, run, onPhotosChanged, decisions: () => decisions };
}

describe('automatic pair album', () => {
  it('rechecks old detector negatives without replacing the saved enrollment', async () => {
    const f = fixture();
    vi.mocked(f.engine.detect).mockResolvedValueOnce([face(0)]);
    await f.run();
    const old = structuredClone(f.decisions());
    expect(old.a.version).toContain(`:detector:${FACE_DETECTION_POLICY_VERSION}`);
    old.a.version = old.a.version.replace(`:detector:${FACE_DETECTION_POLICY_VERSION}`, '');
    vi.mocked(f.storage.loadDecisions).mockResolvedValue(old);
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { cached: 0, added: 1 } });
    expect(f.engine.detect).toHaveBeenCalledTimes(2);
    expect(f.storage.saveEnrollment).not.toHaveBeenCalled();
  });

  it('preserves existing imports and removals across a detector-policy update', async () => {
    const f = fixture();
    await f.run();
    const old = structuredClone(f.decisions());
    old.a.version = old.a.version.replace(`:detector:${FACE_DETECTION_POLICY_VERSION}`, '');
    vi.mocked(f.storage.loadDecisions).mockResolvedValue(old);
    await f.repository.remove('photo-a');
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { cached: 1, added: 0 } });
    expect(await f.repository.list()).toHaveLength(0);
    expect(f.engine.detect).toHaveBeenCalledOnce();
  });
  it('rechecks a cached rejection when the matching cutoff changes, then imports a durable sky copy', async () => {
    const f = fixture();
    vi.mocked(f.engine.detect).mockResolvedValue([face(0), face(1)]);
    vi.mocked(f.engine.embed).mockImplementation(async (_uri, box) => {
      const embedding = vector(box.x);
      embedding[box.x] = 0.8;
      embedding[2] = 0.6;
      return embedding;
    });
    expect(await f.run(0.9)).toMatchObject({ kind: 'complete', progress: { added: 0, uncertain: 1 } });
    expect(await f.run(0.75)).toMatchObject({ kind: 'complete', progress: { added: 1, cached: 0 } });
    expect(await f.repository.list()).toHaveLength(1);
    expect(f.engine.detect).toHaveBeenCalledTimes(2);
    await f.run(0.85);
    expect(f.engine.detect).toHaveBeenCalledTimes(2);
  });
  it('imports group pictures containing both enrolled identities', async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { checked: 1, added: 1, failed: 0 } });
    expect(await f.repository.list()).toHaveLength(1);
    expect(f.onPhotosChanged).toHaveBeenCalledOnce();
    expect(f.decisions().a.photoIds).toEqual(['photo-a']);
  });

  it.each([{ indices: [0] }, { indices: [1] }, { indices: [2, 3] }, { indices: [] }])('does not import faces $indices without both people', async ({ indices }) => {
    const f = fixture(); vi.mocked(f.engine.detect).mockResolvedValue(indices.map(face));
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { added: 0 } });
    expect(await f.repository.list()).toHaveLength(0);
  });

  it('skips inference on unchanged assets but finds later additions', async () => {
    const f = fixture(); await f.run();
    await f.run();
    expect(f.engine.detect).toHaveBeenCalledOnce();
    vi.mocked(f.library.page).mockResolvedValue({ photos: [{ id: 'a', version: '1' }, { id: 'b', version: '1' }], next: null });
    vi.mocked(f.library.localUri).mockImplementation(async (id) => `file:///${id}.jpg`);
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { checked: 1, added: 1 } });
    expect(await f.repository.list()).toHaveLength(2);
  });

  it('does not resurrect removed photos after asset edits or a new identical library asset', async () => {
    const f = fixture(); await f.run(); await f.repository.remove('photo-a');
    vi.mocked(f.library.page).mockResolvedValue({ photos: [{ id: 'a', version: '2' }, { id: 'duplicate', version: '1' }], next: null });
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { added: 0 } });
    expect(await f.repository.list()).toHaveLength(0);
  });

  it('keeps a removal suppressed even if importing succeeded but saving the scan decision failed', async () => {
    const f = fixture(); vi.mocked(f.storage.saveDecisions).mockRejectedValueOnce(new Error('disk full'));
    expect(await f.run()).toMatchObject({ kind: 'failed' });
    expect(await f.repository.list()).toHaveLength(1);
    expect(f.decisions()).toEqual({});
    await f.repository.remove('photo-a');
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { added: 0 } });
    expect(await f.repository.list()).toHaveLength(0);
  });

  it('retries an edited nonmatch', async () => {
    const f = fixture(); vi.mocked(f.engine.detect).mockResolvedValueOnce([face(0)]);
    await f.run();
    vi.mocked(f.library.page).mockResolvedValue({ photos: [{ id: 'a', version: '2' }], next: null });
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { added: 1 } });
  });

  it('keeps failed embeddings undecided so Retry can add the photo later', async () => {
    const f = fixture(); vi.mocked(f.engine.embed).mockRejectedValueOnce(new Error('native failure'));
    expect(await f.run()).toMatchObject({ kind: 'partial', progress: { failed: 1, embeddingFailures: 1 } });
    expect(f.decisions()).toEqual({});
    expect(await f.run()).toMatchObject({ kind: 'complete', progress: { added: 1 } });
  });

  it('keeps cloud-only photos undecided without downloading them', async () => {
    const f = fixture(); vi.mocked(f.library.localUri).mockResolvedValue(null);
    expect(await f.run()).toMatchObject({ kind: 'partial', progress: { failed: 1, unavailableFiles: 1 } });
    expect(f.engine.detect).not.toHaveBeenCalled();
    expect(f.decisions()).toEqual({});
  });

  it('does not let an unreadable asset prevent checking later photos', async () => {
    const f = fixture();
    vi.mocked(f.library.page).mockResolvedValue({ photos: [{ id: 'a', version: '1' }, { id: 'b', version: '1' }], next: null });
    vi.mocked(f.library.localUri).mockRejectedValueOnce(new Error('private path')).mockResolvedValue('file:///b.jpg');
    expect(await f.run()).toMatchObject({ kind: 'partial', progress: { added: 1, failed: 1, readFailures: 1 } });
    expect(f.decisions().a).toBeUndefined();
    expect(f.decisions().b.photoIds).toEqual(['photo-b']);
  });

  it('does not request permissions while resuming, and distinguishes denial', async () => {
    const f = fixture(); vi.mocked(f.library.permission).mockResolvedValue('denied');
    expect(await f.run()).toEqual({ kind: 'permission-denied' });
    expect(f.library.permission).toHaveBeenCalledWith(false);
    expect(f.library.page).not.toHaveBeenCalled();
  });

  it('reports limited access separately', async () => {
    const f = fixture(); vi.mocked(f.library.permission).mockResolvedValue('limited');
    expect(await f.run()).toMatchObject({ kind: 'complete', access: 'limited' });
  });

  it('cancels after resolving a file without importing or persisting a decision', async () => {
    const f = fixture(); vi.mocked(f.library.localUri).mockImplementation(async () => { f.abort.abort(); return 'file:///a.jpg'; });
    expect(await f.run()).toEqual({ kind: 'cancelled' });
    expect(await f.repository.list()).toHaveLength(0);
    expect(f.storage.saveDecisions).not.toHaveBeenCalled();
  });

  it('distinguishes unavailable model and an enrollment version change', async () => {
    const f = fixture(); vi.mocked(f.engine.isAvailable).mockResolvedValue(false);
    expect(await f.run()).toEqual({ kind: 'unavailable' });
    f.engine.modelId = 'next-version';
    expect(await f.run()).toEqual({ kind: 'enrollment-required' });
  });

  it('handles pagination and refuses a repeating cursor', async () => {
    const f = fixture(); vi.mocked(f.library.page).mockResolvedValue({ photos: [], next: 'same' });
    expect(await f.run()).toMatchObject({ kind: 'failed' });
    expect(f.library.page).toHaveBeenCalledTimes(2);
  });

  it('does not report a failed library read as an empty album', async () => {
    const f = fixture(); vi.mocked(f.library.page).mockRejectedValue(new Error('private filename'));
    expect(await f.run()).toMatchObject({ kind: 'failed', progress: { checked: 0, added: 0, failed: 0 } });
  });
});

describe('one-time face enrollment', () => {
  it('embeds only a single-face reference and labels the supplied identity', async () => {
    const f = fixture(); vi.mocked(f.engine.detect).mockResolvedValue([face(0)]);
    expect(await enrollSoloFace(f.engine, 'file:///reference', 'you', f.abort.signal)).toEqual(enrollment.prints[0]);
  });
  it('rejects a group reference rather than guessing which person is which', async () => {
    const f = fixture(); await expect(enrollSoloFace(f.engine, 'file:///group', 'you', f.abort.signal)).rejects.toThrow('only this person');
  });
  it('rejects the same identity for both people', () => {
    expect(() => pairEnrollment(enrollment.prints[0], { person: 'partner', embedding: vector(0) })).toThrow('same person');
    expect(pairEnrollment(...enrollment.prints)).toMatchObject({ ...enrollment, referenceId: expect.any(String) });
  });
});
