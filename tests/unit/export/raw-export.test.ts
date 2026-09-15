import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => {}),
}));

vi.mock('expo-file-system', () => ({
  Directory: class Directory {
    create() {}
    delete() {}
  },
  File: class File {
    static async downloadFileAsync(): Promise<never> {
      throw new Error('not implemented in tests');
    }
    get uri(): string {
      return 'file:///cache/raw-export/test.bin';
    }
    get size(): number {
      return 0;
    }
    create() {}
    delete() {}
    open(): never {
      throw new Error('not implemented in tests');
    }
  },
  Paths: { cache: 'file:///cache' },
}));

vi.mock('@/features/api-client', () => ({
  apiFetch: vi.fn(async () => ({})),
  getApiBaseUrl: () => 'https://api.test',
  getApiTokens: () => null,
}));

import {
  exportRawArchive,
  rawMediaServePath,
  type RawExportDeps,
  type RawExportManifest,
} from '@/features/export/raw-export';
import type { ZipAppendSink } from '@/features/export/zip-store';

const API = 'https://api.test';

function photoBytes(): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
}

function fixtures() {
  const momentNote = {
    id: 'm-note',
    type: 'note',
    title: 'First',
    body: 'held',
    occurredAt: '2026-01-10T00:00:00.000Z',
    createdAt: '2026-01-10T00:00:00.000Z',
    authorId: 'user-a',
    authorRole: 'you',
    authorName: 'You',
  };
  const momentGoal = {
    id: 'm-goal',
    type: 'goal',
    title: 'Run a 10k',
    body: '',
    occurredAt: '2026-01-11T00:00:00.000Z',
    createdAt: '2026-01-11T00:00:00.000Z',
    authorId: 'user-a',
    authorRole: 'you',
    authorName: 'You',
  };
  const momentMedia = {
    id: 'm-photo',
    type: 'media',
    title: 'Lake',
    body: '',
    occurredAt: '2026-01-12T00:00:00.000Z',
    createdAt: '2026-01-12T00:00:00.000Z',
    authorId: 'user-b',
    authorRole: 'partner',
    authorName: 'Deleted member',
    mediaId: 'media-1',
  };
  return {
    '/v1/spaces/current': {
      space: {
        id: 'space-1',
        name: 'Our Space',
        partnerName: 'Partner',
        relationshipStartDate: '2026-01-01',
        createdByUserId: 'user-a',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      inviteCode: 'SECRET-INVITE-CODE',
    },
    '/v1/spaces/current/moments?limit=100': {
      moments: [momentMedia, momentGoal],
      nextCursor: 'cursor-1',
    },
    '/v1/spaces/current/moments?limit=100&cursor=cursor-1': {
      moments: [momentNote],
    },
    '/v1/spaces/current/calendar/events?from=2000-01-01T00%3A00%3A00.000Z&to=2100-01-01T00%3A00%3A00.000Z': [
      { id: 'e-1', title: 'Anniversary' },
    ],
    '/v1/spaces/current/proposals': { proposals: [{ id: 'p-1', title: 'Dinner' }] },
    '/v1/spaces/current/someday': { items: [{ id: 's-1', title: 'Kyoto' }] },
    '/v1/spaces/current/imported-milestones': [{ id: 'g-1', type: 'goal', title: 'Save more' }],
    '/v1/spaces/current/question': { weekKey: '2026-W03', answers: [{ answer: 'our song' }] },
    '/v1/spaces/current/letters': {
      letters: [
        { id: 'l-sealed', caption: 'Later', sealedUntil: '2027-01-01T00:00:00.000Z', authorName: 'Deleted member' },
        {
          id: 'l-open',
          caption: 'Now',
          body: 'opened words',
          sealedUntil: '2026-01-01T00:00:00.000Z',
          openedAt: '2026-01-02T00:00:00.000Z',
          authorName: 'Deleted member',
        },
      ],
    },
  } as Record<string, unknown>;
}

class MemorySink implements ZipAppendSink {
  bytes = new Uint8Array(0);
  writeBytes(chunk: Uint8Array): void {
    const next = new Uint8Array(this.bytes.length + chunk.length);
    next.set(this.bytes, 0);
    next.set(chunk, this.bytes.length);
    this.bytes = next;
  }
  patchBytes(offset: number, chunk: Uint8Array): void {
    this.bytes.set(chunk, offset);
  }
}

type FakeStore = { files: Map<string, Uint8Array> };

function makeStore(): FakeStore {
  return { files: new Map() };
}

type FakeCalls = {
  json: string[];
  downloads: string[];
  shared: string[];
  removedTemps: string[];
  deletedFiles: string[];
  rotated: number;
};

let stagingCounter = 0;

function makeDeps(
  overrides: {
    json?: Record<string, unknown>;
    media?: Record<string, Uint8Array>;
    failMediaUrls?: string[];
    failJsonPaths?: string[];
    share?: 'ok' | 'cancel' | 'unavailable';
  } = {},
  store: FakeStore = makeStore()
): { deps: RawExportDeps; calls: FakeCalls; sink: MemorySink; store: FakeStore; zipUri: string; tmpUri: string } {
  const calls: FakeCalls = {
    json: [],
    downloads: [],
    shared: [],
    removedTemps: [],
    deletedFiles: [],
    rotated: 0,
  };
  const sink = new MemorySink();
  const json = overrides.json ?? fixtures();
  const tag = `run-${(stagingCounter += 1)}`;
  const tmpUri = `mem:/tmp-${tag}`;
  const zipUri = `mem:/exports/aoi-export-${tag}.zip`;
  const deps: RawExportDeps = {
    fetchJson: async (path: string) => {
      calls.json.push(path);
      if (overrides.failJsonPaths?.includes(path)) {
        throw new Error('Request failed: 500');
      }
      if (!(path in json)) {
        throw new Error(`unexpected fetch: ${path}`);
      }
      return json[path];
    },
    downloadMediaToFile: async (url: string, destUri: string) => {
      calls.downloads.push(url);
      if (overrides.failMediaUrls?.some((part) => url.includes(part))) {
        throw new Error('Media request failed: 503');
      }
      const bytes = overrides.media?.[url] ?? photoBytes();
      store.files.set(destUri, bytes);
      return { sizeBytes: bytes.length, contentType: 'image/png' };
    },
    fs: {
      rotatePriorExports: async () => {
        calls.rotated += 1;
        for (const key of [...store.files.keys()]) {
          if (key.startsWith('mem:/exports/') && key.endsWith('.zip')) {
            store.files.delete(key);
            calls.deletedFiles.push(key);
          }
        }
      },
      createStaging: async () => ({
        tmpDirUri: tmpUri,
        zipUri,
        mediaUri: (name: string) => `${tmpUri}/${name}`,
      }),
      openZipSink: async () => ({
        writeBytes: (chunk: Uint8Array) => sink.writeBytes(chunk),
        patchBytes: (offset: number, chunk: Uint8Array) => sink.patchBytes(offset, chunk),
        close: async () => {
          store.files.set(zipUri, sink.bytes);
        },
      }),
      readChunk: async (uri: string, offset: number, length: number) => {
        const bytes = store.files.get(uri);
        if (!bytes) throw new Error(`missing temp file: ${uri}`);
        return bytes.subarray(offset, offset + length);
      },
      fileSize: async (uri: string) => store.files.get(uri)?.length ?? 0,
      deleteFile: async (uri: string) => {
        calls.deletedFiles.push(uri);
        store.files.delete(uri);
      },
      removeTempDir: async (dirUri: string) => {
        calls.removedTemps.push(dirUri);
        for (const key of [...store.files.keys()]) {
          if (key === dirUri || key.startsWith(`${dirUri}/`)) {
            store.files.delete(key);
          }
        }
      },
    },
    isSharingAvailable: async () => overrides.share !== 'unavailable',
    shareFile: async (uri: string) => {
      calls.shared.push(uri);
      if (overrides.share === 'cancel') {
        throw new Error('User cancelled the share sheet');
      }
    },
    now: () => new Date('2026-03-01T12:00:00.000Z'),
  };
  return { deps, calls, sink, store, zipUri, tmpUri };
}

/** Reuse the zip parser shape: read central directory names + raw parts. */
function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no EOCD');
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const text = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i += 1) {
    const size = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = text.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    out.set(name, bytes.subarray(start, start + size));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (entries: Map<string, Uint8Array>, name: string): unknown =>
  JSON.parse(new TextDecoder().decode(entries.get(name) ?? new Uint8Array()));

describe('exportRawArchive', () => {
  it('archives every dataset with manifest/version and original media bytes', async () => {
    const { deps, calls, sink, store, zipUri, tmpUri } = makeDeps();
    const result = await exportRawArchive({ userId: 'user-a' }, deps);
    expect(result).toEqual({ status: 'shared', mediaErrors: 0 });

    const entries = zipEntries(sink.bytes);
    for (const name of [
      'space.json',
      'moments.json',
      'calendar-events.json',
      'proposals.json',
      'someday.json',
      'milestones.json',
      'question.json',
      'letters.json',
      'manifest.json',
    ]) {
      expect(entries.has(name), name).toBe(true);
    }

    // Paging reached the second page; goal + milestone-goal represented.
    const moments = decode(entries, 'moments.json') as { id: string; type: string }[];
    expect(moments.map((m) => m.id)).toEqual(['m-photo', 'm-goal', 'm-note']);
    expect(moments.map((m) => m.type)).toContain('goal');
    expect(decode(entries, 'milestones.json') as { type: string }[]).toEqual([
      expect.objectContaining({ type: 'goal' }),
    ]);

    // Invite credential is not archive data.
    expect(JSON.stringify(decode(entries, 'space.json'))).not.toContain('SECRET-INVITE-CODE');

    // Media: authenticated original-variant URL, byte-exact, predictable dir.
    expect(calls.downloads).toEqual([`${API}${rawMediaServePath('media-1')}`]);
    const mediaName = [...entries.keys()].find((n) => n.startsWith('media/'));
    expect(mediaName).toBe('media/media-1.png');
    expect([...(entries.get(mediaName!) ?? [])]).toEqual([...photoBytes()]);

    const manifest = decode(entries, 'manifest.json') as RawExportManifest;
    expect(manifest).toMatchObject({
      exportVersion: 1,
      generatedAt: '2026-03-01T12:00:00.000Z',
      exportedByUserId: 'user-a',
      spaceId: 'space-1',
      errors: [],
    });
    expect(manifest.datasets).toMatchObject({
      moments: 3,
      calendarEvents: 1,
      proposals: 1,
      somedayItems: 1,
      importedMilestones: 1,
      letters: 2,
      mediaFiles: 1,
    });

    // No durable server state: only GET reads happened (plus local share).
    expect(calls.json.every((p) => p.startsWith('/v1/'))).toBe(true);
    expect(calls.shared).toEqual([zipUri]);
    // Final ZIP retained for lazy share consumers; rotation ran first.
    expect(calls.rotated).toBe(1);
    expect(store.files.get(zipUri)).toBeDefined();
    expect(calls.deletedFiles).not.toContain(zipUri);
    // Intermediate media staging always cleaned.
    expect(calls.removedTemps).toEqual([tmpUri]);
    expect([...store.files.keys()].some((k) => k.startsWith(`${tmpUri}/`))).toBe(false);
  });

  it('omits sealed letter bodies and keeps opened ones (API-authorized shape)', async () => {
    const { deps, sink } = makeDeps();
    await exportRawArchive({ userId: 'user-a' }, deps);
    const letters = decode(zipEntries(sink.bytes), 'letters.json') as Record<string, unknown>[];
    const sealed = letters.find((l) => l.id === 'l-sealed');
    const opened = letters.find((l) => l.id === 'l-open');
    expect(sealed).toBeDefined();
    expect('body' in (sealed ?? {})).toBe(false);
    expect(opened).toMatchObject({ body: 'opened words' });
  });

  it('never leaks purged account identity from tombstone-shaped payloads', async () => {
    const { deps, sink } = makeDeps();
    await exportRawArchive({ userId: 'user-a' }, deps);
    const entries = zipEntries(sink.bytes);
    const serialized = [...entries.values()]
      .map((bytes) => new TextDecoder().decode(bytes))
      .join('\n')
      .toLowerCase();
    for (const secret of [
      'aoi@example.com',
      'access_token',
      'refresh_token',
      'id_token',
      'expo-push-token',
      'revenuecat',
      'webhook',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it('records unreachable media explicitly and still shares the archive', async () => {
    const failingUrl = `${API}${rawMediaServePath('media-1')}`;
    const { deps, sink } = makeDeps({ failMediaUrls: [failingUrl] });
    const result = await exportRawArchive({ userId: 'user-a' }, deps);
    expect(result).toEqual({ status: 'shared', mediaErrors: 1 });

    const entries = zipEntries(sink.bytes);
    expect([...entries.keys()].some((n) => n.startsWith('media/'))).toBe(false);
    const manifest = decode(entries, 'manifest.json') as RawExportManifest;
    expect(manifest.errors).toEqual([
      { mediaId: 'media-1', file: expect.any(String), message: 'Media request failed: 503' },
    ]);
    expect(manifest.datasets.mediaFiles).toBe(0);
  });

  it('fails honestly with no space and cleans staging on dataset failure', async () => {
    const noSpace = makeDeps({ json: { '/v1/spaces/current': { space: null, inviteCode: null } } });
    expect(await exportRawArchive({ userId: 'user-a' }, noSpace.deps)).toEqual({
      status: 'failed',
      error: 'There is no active Space to export.',
    });
    expect(noSpace.calls.removedTemps).toEqual([noSpace.tmpUri]);
    expect(noSpace.calls.shared).toEqual([]);
    // Never handed to the share sheet: the partial ZIP is deleted now.
    expect(noSpace.calls.deletedFiles).toContain(noSpace.zipUri);
    expect(noSpace.store.files.get(noSpace.zipUri)).toBeUndefined();

    const broken = makeDeps({ failJsonPaths: ['/v1/spaces/current/moments?limit=100'] });
    const result = await exportRawArchive({ userId: 'user-a' }, broken.deps);
    expect(result.status).toBe('failed');
    expect(broken.calls.removedTemps).toEqual([broken.tmpUri]);
    expect(broken.calls.deletedFiles).toContain(broken.zipUri);
  });

  it('distinguishes cancellation from failure; handed-over ZIPs are retained', async () => {
    const cancelled = makeDeps({ share: 'cancel' });
    expect(await exportRawArchive({ userId: 'user-a' }, cancelled.deps)).toEqual({ status: 'cancelled' });
    // Cancelled after presenting the sheet: ZIP retained for lazy readers.
    expect(cancelled.store.files.get(cancelled.zipUri)).toBeDefined();
    expect(cancelled.calls.deletedFiles).not.toContain(cancelled.zipUri);
    expect(cancelled.calls.removedTemps).toEqual([cancelled.tmpUri]);

    const unavailable = makeDeps({ share: 'unavailable' });
    expect(await exportRawArchive({ userId: 'user-a' }, unavailable.deps)).toEqual({
      status: 'failed',
      error: 'Sharing is not available on this device.',
    });
    // Never handed over: partial ZIP deleted immediately.
    expect(unavailable.calls.deletedFiles).toContain(unavailable.zipUri);
    expect(unavailable.store.files.get(unavailable.zipUri)).toBeUndefined();
    expect(unavailable.calls.removedTemps).toEqual([unavailable.tmpUri]);
  });

  it('rotates prior final ZIPs at the next export (retention stays bounded)', async () => {
    const store = makeStore();
    const first = makeDeps({}, store);
    expect(await exportRawArchive({ userId: 'user-a' }, first.deps)).toEqual({
      status: 'shared',
      mediaErrors: 0,
    });
    expect(store.files.get(first.zipUri)).toBeDefined();

    const second = makeDeps({}, store);
    expect(await exportRawArchive({ userId: 'user-a' }, second.deps)).toEqual({
      status: 'shared',
      mediaErrors: 0,
    });
    // Prior final ZIP rotated away; exactly one retained.
    expect(second.calls.deletedFiles).toContain(first.zipUri);
    expect(store.files.get(first.zipUri)).toBeUndefined();
    expect(store.files.get(second.zipUri)).toBeDefined();
    const retainedZips = [...store.files.keys()].filter(
      (k) => k.startsWith('mem:/exports/') && k.endsWith('.zip')
    );
    expect(retainedZips).toEqual([second.zipUri]);
  });

  it('refuses unsigned callers without touching disk or network', async () => {
    const { deps, calls } = makeDeps();
    expect(await exportRawArchive({ userId: '' }, deps)).toEqual({
      status: 'failed',
      error: 'You are signed out. Sign in and try again.',
    });
    expect(calls.json).toEqual([]);
    expect(calls.removedTemps).toEqual([]);
    expect(calls.rotated).toBe(0);
  });
});
