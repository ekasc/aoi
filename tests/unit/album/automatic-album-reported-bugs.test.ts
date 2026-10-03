import { describe, expect, it, vi } from 'vitest';

import { scanAutomaticAlbum, type AlbumEnrollment, type AutomaticAlbumStorage, type PhotoLibrary, type RecognitionEngine, type ScanCheckpoint, type ScanDecisions } from '@/features/album/automatic-album';
import { SFACE_MODEL_ID } from '@/features/album/face-recognition-engine';

function fixture() {
  const vector = (index: number) => { const v = new Float32Array(128); v[index] = 1; return v; };
  const enrollment: AlbumEnrollment = { modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] };
  const engine: RecognitionEngine = { modelId: SFACE_MODEL_ID, isAvailable: async () => true, detect: async () => [], embed: async () => vector(0), dispose: async () => {}, match: () => ({ kind: 'unsure', confidence: 0 }) };
  const storage: AutomaticAlbumStorage = {
    loadEnrollment: async () => enrollment, saveEnrollment: async () => {}, forgetEnrollment: async () => {},
    loadDecisions: async () => ({}), saveDecisions: vi.fn(async () => {}),
  };
  const library: PhotoLibrary = {
    permission: async () => 'full', page: async () => ({ photos: Array.from({ length: 40 }, (_, i) => ({ id: String(i), version: '1' })), next: null, total: 40 }),
    localUri: vi.fn(async () => null), subscribe: () => () => {},
  };
  const repository = { list: async () => [], importPhotos: async () => [], remove: async () => {}, dispose: () => {} };
  return { engine, enrollment, storage, library, repository, signal: new AbortController().signal, onProgress: vi.fn(), onPhotosChanged: () => {} };
}

describe('reported first-scan failures', () => {
  it('does not call a scan complete when every asset failed access', async () => {
    const f = fixture();
    expect(await scanAutomaticAlbum(f)).toMatchObject({ kind: 'partial', progress: { visited: 40, total: 40, failed: 40, checked: 0 } });
  });

  it('checkpoints a page of negative decisions once, not a growing full index for every photo', async () => {
    const f = fixture(); vi.mocked(f.library.localUri).mockResolvedValue('file:///synthetic.jpg');
    expect(await scanAutomaticAlbum(f)).toMatchObject({ kind: 'complete' });
    expect(f.storage.saveDecisions).toHaveBeenCalledTimes(1);
  });

  it('resumes a timed slice at the last visited asset without double-counting or re-reading it', async () => {
    const f = fixture();
    let checkpoint: ScanCheckpoint | null = null;
    let decisions: ScanDecisions = {};
    let clock = 0;
    f.storage.loadDecisions = async () => decisions;
    f.storage.saveDecisions = async (next) => { decisions = structuredClone(next); };
    f.storage.loadCheckpoint = async () => checkpoint;
    f.storage.saveCheckpoint = async (next) => { checkpoint = structuredClone(next); };
    f.library.page = vi.fn(async (after) => ({ photos: ['a', 'b', 'c'].slice(after ? ['a', 'b', 'c'].indexOf(after) + 1 : 0).map((id) => ({ id, version: '1' })), next: null, total: 3 }));
    vi.mocked(f.library.localUri).mockResolvedValue('file:///synthetic.jpg');
    const run = () => scanAutomaticAlbum({ ...f, maxDurationMs: 2, now: () => clock, yieldWork: async () => { clock++; } });
    expect(await run()).toMatchObject({ kind: 'queued', progress: { visited: 2, checked: 2, total: 3 } });
    expect(await run()).toMatchObject({ kind: 'complete', progress: { visited: 3, checked: 3, cached: 0, total: 3 } });
    expect(f.library.localUri).toHaveBeenCalledTimes(3);
    expect(f.library.page).toHaveBeenLastCalledWith('b', undefined);
  });

  it('commits pending negative decisions when paused and skips them on resume', async () => {
    const f = fixture();
    const abort = new AbortController();
    let checkpoint: ScanCheckpoint | null = null;
    let decisions: ScanDecisions = {};
    f.storage.loadDecisions = async () => decisions;
    f.storage.saveDecisions = async (next) => { decisions = structuredClone(next); };
    f.storage.loadCheckpoint = async () => checkpoint;
    f.storage.saveCheckpoint = async (next) => { checkpoint = structuredClone(next); };
    f.library.page = vi.fn(async (after) => ({ photos: (after ? ['b'] : ['a', 'b']).map((id) => ({ id, version: '1' })), next: null, total: 2 }));
    vi.mocked(f.library.localUri).mockResolvedValue('file:///synthetic.jpg');
    expect(await scanAutomaticAlbum({ ...f, signal: abort.signal, yieldWork: async () => abort.abort() })).toEqual({ kind: 'cancelled' });
    expect(Object.keys(decisions)).toEqual(['a']);
    expect(await scanAutomaticAlbum(f)).toMatchObject({ kind: 'complete', progress: { visited: 2, checked: 2 } });
    expect(f.library.localUri).toHaveBeenCalledTimes(2);
  });

  it('invalidates negative matches when references change, rather than silently keeping a zero-match result', async () => {
    const f = fixture();
    let decisions: ScanDecisions = {};
    f.storage.loadDecisions = async () => decisions;
    f.storage.saveDecisions = async (next) => { decisions = structuredClone(next); };
    vi.mocked(f.library.localUri).mockResolvedValue('file:///synthetic.jpg');
    await scanAutomaticAlbum(f);
    await scanAutomaticAlbum(f);
    expect(f.library.localUri).toHaveBeenCalledTimes(40);
    f.enrollment.referenceId = 'new-references';
    await scanAutomaticAlbum(f);
    expect(f.library.localUri).toHaveBeenCalledTimes(80);
  });
  it('restarts pagination when the dating-date range changes, but reuses unchanged face decisions', async () => {
    const f = fixture();
    let checkpoint: ScanCheckpoint | null = null;
    let decisions: ScanDecisions = {};
    f.storage.loadDecisions = async () => decisions;
    f.storage.saveDecisions = async (next) => { decisions = structuredClone(next); };
    f.storage.loadCheckpoint = async () => checkpoint;
    f.storage.saveCheckpoint = async (next) => { checkpoint = structuredClone(next); };
    const page = vi.fn(async (after?: string) => ({ photos: (after ? ['b'] : ['a', 'b']).map((id) => ({ id, version: '1' })), next: null, total: 2 }));
    f.library.page = page;
    vi.mocked(f.library.localUri).mockResolvedValue('file:///synthetic.jpg');
    let clock = 0;
    expect(await scanAutomaticAlbum({ ...f, since: 1000, maxDurationMs: 1, now: () => clock, yieldWork: async () => { clock++; } })).toMatchObject({ kind: 'queued' });
    expect(await scanAutomaticAlbum({ ...f, since: 500 })).toMatchObject({ kind: 'complete', progress: { visited: 2, cached: 1, checked: 1 } });
    expect(page).toHaveBeenLastCalledWith(undefined, 500);
    expect(f.library.localUri).toHaveBeenCalledTimes(2);
  });
});
