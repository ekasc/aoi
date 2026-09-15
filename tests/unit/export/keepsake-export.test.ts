import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-print', () => ({
  printToFileAsync: vi.fn(),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => {}),
}));

vi.mock('expo-file-system', () => ({
  Directory: class Directory {
    constructor(..._parts: unknown[]) {}
    get exists() {
      return false;
    }
    create() {}
    list() {
      return [];
    }
  },
  File: class File {
    readonly uri: string;
    static deleted: string[] = [];
    constructor(...parts: unknown[]) {
      this.uri = String(parts[parts.length - 1] ?? '');
    }
    copy() {}
    delete() {
      (this.constructor as typeof File).deleted.push(this.uri);
    }
    write() {}
  },
  Paths: { cache: 'file:///cache/' },
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(async () => ({ uri: 'file:///cache/manip.jpg', width: 1600, height: 1200 })),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

vi.mock('@/features/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/api-client')>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchSpy(...args),
    apiFetchBytes: (...args: unknown[]) => apiFetchBytesSpy(...args),
  };
});

const apiFetchSpy = vi.fn(async () => ({}));

const apiFetchBytesSpy = vi.fn(async (_path: string) => ({
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'image/jpeg',
  status: 200,
}));

import {
  buildKeepsakeHtml,
  escapeKeepsakeHtml,
  type KeepsakeDocumentInput,
} from '@/features/export/keepsake-document';
import { exportKeepsakePdf, type KeepsakeExportDeps } from '@/features/export/keepsake-export';

function photoChapter(): KeepsakeDocumentInput {
  return {
    cover: {
      title: 'August 2026',
      subtitle: '3 memories',
      dateLine: 'August 2026',
      photoUri: 'https://cdn.test/cover.jpg',
    },
    entries: [
      { kind: 'note', date: 'August 2, 2026', title: 'First', body: 'Hello.' },
      { kind: 'photo', date: 'August 10, 2026', title: null, uri: 'https://cdn.test/p1.jpg' },
      { kind: 'voice', date: 'August 20, 2026', title: 'Evening' },
    ],
  };
}

describe('buildKeepsakeHtml', () => {
  it('orders entries oldest-first as given', () => {
    const html = buildKeepsakeHtml(photoChapter());
    const first = html.indexOf('August 2, 2026');
    const second = html.indexOf('August 10, 2026');
    const third = html.indexOf('August 20, 2026');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('uses the representative cover photo without mutating the source', () => {
    const html = buildKeepsakeHtml(photoChapter());
    expect(html).toContain('src="https://cdn.test/cover.jpg"');
    // Fitted presentation only — the source URL is untouched.
    expect(html).toContain('https://cdn.test/p1.jpg');
    expect(html).not.toContain('thumb');
  });

  it('falls back to paper/type cover without photography', () => {
    const html = buildKeepsakeHtml({
      cover: { title: 'August 2026', subtitle: '1 memory', dateLine: 'August 2026', photoUri: null },
      entries: [{ kind: 'note', date: 'August 2, 2026', title: null, body: 'Only words.' }],
    });
    expect(html).toContain('cover-fallback');
    expect(html).toContain('cover-numeral');
    expect(html).not.toContain('<img');
  });

  it('represents voice truthfully with no fake playback or duration', () => {
    const html = buildKeepsakeHtml(photoChapter());
    expect(html).toContain('Voice memory');
    expect(html).toContain('Listen in Aoi');
    expect(html).not.toMatch(/<audio|duration|0:00|play-button/);
  });

  it('lets long notes paginate instead of truncating', () => {
    const longBody = 'A very long note. '.repeat(500);
    const html = buildKeepsakeHtml({
      cover: { title: 'T', subtitle: '1 memory', dateLine: 'T', photoUri: null },
      entries: [{ kind: 'note', date: 'D', title: null, body: longBody }],
    });
    expect(html).toContain(escapeKeepsakeHtml(longBody.slice(0, 100)));
    // No fixed heights on text, no overflow clipping, no truncation markers.
    // (Photos intentionally fit the page via max-height + contain — the
    // source is never cropped, and text has no such bound at all.)
    const bodyBlock = html.match(/\.entry-body\s*\{[^}]*\}/)?.[0] ?? '';
    expect(bodyBlock).not.toMatch(/(^|[;{\s])max-height\s*:/);
    expect(bodyBlock).not.toMatch(/(^|[;{\s])height\s*:/);
    expect(html).not.toMatch(/overflow:\s*hidden/);
    expect(html).not.toMatch(/\.\.\./);
  });

  it('escapes user content', () => {
    const html = buildKeepsakeHtml({
      cover: { title: '<b>Hi</b>', subtitle: '1 memory', dateLine: 'D', photoUri: null },
      entries: [{ kind: 'note', date: 'D', title: null, body: '<script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('embeds no fonts and references only system families', () => {
    const html = buildKeepsakeHtml(photoChapter());
    expect(html).not.toMatch(/@font-face|base64|New York|Trebuchet|Menlo|unknown mono/i);
    expect(html).toMatch(/Georgia/);
  });

  it('keeps export-safe margins and a restrained closing line', () => {
    const html = buildKeepsakeHtml(photoChapter());
    expect(html).toMatch(/@page/);
    expect(html).toContain('Kept with Aoi');
  });
});

function makeDeps(overrides: Partial<KeepsakeExportDeps> = {}): KeepsakeExportDeps & {
  calls: { printed: string[]; shared: string[]; placed: string[]; rotations: number; tempRemoved: string[][] };
} {
  const calls = {
    printed: [] as string[],
    shared: [] as string[],
    placed: [] as string[],
    rotations: 0,
    tempRemoved: [] as string[][],
  };
  return {
    calls,
    printToFile: vi.fn(async (html: string) => {
      calls.printed.push(html);
      return { uri: 'file:///cache/print.pdf' };
    }),
    placeFile: vi.fn(async (uri: string, name: string) => {
      calls.placed.push(`${uri} -> ${name}`);
      return `file:///cache/keepsakes/${name}.pdf`;
    }),
    isSharingAvailable: vi.fn(async () => true),
    shareFile: vi.fn(async (uri: string) => {
      calls.shared.push(uri);
    }),
    rotateOldFiles: vi.fn(async () => {
      calls.rotations += 1;
    }),
    removeTempFiles: vi.fn(async (uris: string[]) => {
      calls.tempRemoved.push(uris);
    }),
    ...overrides,
  };
}

describe('exportKeepsakePdf', () => {
  it('prints, stages, and shares the rendered document', async () => {
    const deps = makeDeps();
    const result = await exportKeepsakePdf('<html>hi</html>', 'august-2026', deps);

    expect(result).toEqual({ status: 'shared' });
    expect(deps.calls.rotations).toBe(1);
    expect(deps.calls.printed).toEqual(['<html>hi</html>']);
    expect(deps.calls.placed).toEqual(['file:///cache/print.pdf -> august-2026']);
    expect(deps.calls.shared).toEqual(['file:///cache/keepsakes/august-2026.pdf']);
  });

  it('sanitizes the staged filename', async () => {
    const deps = makeDeps();
    await exportKeepsakePdf('<html>hi</html>', 'month:2026/08??', deps);

    expect(deps.calls.placed[0]).toContain('month-2026-08');
  });

  it('render failure reports failure without sharing', async () => {
    const deps = makeDeps({
      printToFile: async () => {
        throw new Error('render blew up');
      },
    });
    const result = await exportKeepsakePdf('<html>hi</html>', 'x', deps);

    expect(result).toEqual({ status: 'failed', error: 'render blew up' });
    expect(deps.calls.shared).toHaveLength(0);
  });

  it('empty input fails fast without touching the pipeline', async () => {
    const deps = makeDeps();
    const result = await exportKeepsakePdf('   ', 'x', deps);

    expect(result.status).toBe('failed');
    expect(deps.calls.printed).toHaveLength(0);
    expect(deps.calls.shared).toHaveLength(0);
  });

  it('unavailable sharing fails without throwing', async () => {
    const deps = makeDeps({ isSharingAvailable: async () => false });
    const result = await exportKeepsakePdf('<html>hi</html>', 'x', deps);

    expect(result.status).toBe('failed');
    expect(deps.calls.shared).toHaveLength(0);
  });

  it('user-cancelled dismissal resolves as cancelled, not failed', async () => {
    const deps = makeDeps({
      shareFile: async () => {
        throw new Error('User dismissed the share sheet');
      },
    });
    const result = await exportKeepsakePdf('<html>hi</html>', 'x', deps);

    expect(result).toEqual({ status: 'cancelled' });
  });

  it('genuine share failures report failure', async () => {
    const deps = makeDeps({
      shareFile: async () => {
        throw new Error('no app can open this');
      },
    });
    const result = await exportKeepsakePdf('<html>hi</html>', 'x', deps);

    expect(result).toEqual({ status: 'failed', error: 'no app can open this' });
  });

  it('creates no chapter/content state: the pipeline is print + share only', async () => {
    const deps = makeDeps();
    await exportKeepsakePdf('<html>hi</html>', 'x', deps);

    // The dependency surface is the whole universe of side effects here:
    // render, stage, availability-check, share, rotate, temp cleanup.
    // No API, no DB.
    expect(Object.keys(deps).sort()).toEqual(
      ['calls', 'isSharingAvailable', 'placeFile', 'printToFile', 'removeTempFiles', 'rotateOldFiles', 'shareFile'].sort()
    );
  });
});

describe('exportResizeAction', () => {
  it('constrains only the long edge to the export bound', async () => {
    const { exportResizeAction, EXPORT_MAX_DIMENSION } = await import(
      '@/features/export/keepsake-assets'
    );
    expect(EXPORT_MAX_DIMENSION).toBe(1600);
    expect(exportResizeAction(4000, 3000)).toEqual({ resize: { width: 1600 } });
    expect(exportResizeAction(3000, 4000)).toEqual({ resize: { height: 1600 } });
    expect(exportResizeAction(1200, 800)).toBeNull();
    expect(exportResizeAction(1600, 1600)).toBeNull();
    expect(exportResizeAction(NaN, 100)).toBeNull();
  });
});

describe('exportChapterKeepsake (authenticated data-URI pipeline)', () => {
  const photoMember = (id: string, uri: string, occurredAt: string) => ({
    id,
    type: 'media' as const,
    title: `Photo ${id}`,
    body: '',
    occurredAt,
    targetAt: null,
    createdAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: uri,
    audioUri: null,
  });

  const noteMember = (id: string, occurredAt: string) => ({
    id,
    type: 'note' as const,
    title: '',
    body: 'Just words.',
    occurredAt,
    targetAt: null,
    createdAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: null,
    audioUri: null,
  });

  function assetDeps(overrides: Record<string, unknown> = {}) {
    const downloaded: string[] = [];
    const written: { name: string }[] = [];
    const removed: string[][] = [];
    const transformed: string[] = [];
    return {
      downloaded,
      written,
      removed,
      transformed,
      deps: {
        downloadAuthed: vi.fn(async (path: string) => {
          downloaded.push(path);
          return { bytes: new Uint8Array([9, 9]), contentType: 'image/jpeg', status: 200 };
        }),
        downloadPublic: vi.fn(async () => ({
          bytes: new Uint8Array([7]),
          contentType: 'image/png',
          status: 200,
        })),
        writeTempFile: vi.fn(async (name: string) => {
          written.push({ name });
          return `file:///cache/keepsakes/assets/${name}`;
        }),
        transformPhoto: vi.fn(async (uri: string) => {
          transformed.push(uri);
          return {
            base64: `base64-for-${uri.split('/').pop()}`,
            width: 1600,
            height: 1200,
            tempUris: [`${uri}.probed`, `${uri}.rendered`],
          };
        }),
        removeTempFiles: vi.fn(async (uris: string[]) => {
          removed.push(uris);
        }),
        ...overrides,
      },
    };
  }

  function exportDeps(overrides: Record<string, unknown> = {}) {
    return {
      printToFile: vi.fn(async () => ({ uri: 'file:///cache/print.pdf' })),
      placeFile: vi.fn(async (_uri: string, name: string) => `file:///cache/keepsakes/${name}.pdf`),
      isSharingAvailable: vi.fn(async () => true),
      shareFile: vi.fn(async () => {}),
      rotateOldFiles: vi.fn(async () => {}),
      removeTempFiles: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('embeds data URIs for photos; HTML has no remote or file photo refs', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const assets = assetDeps();
    const exporter = exportDeps();
    let printedHtml = '';
    exporter.printToFile.mockImplementation(async (html: string) => {
      printedHtml = html;
      return { uri: 'file:///cache/print.pdf' };
    });

    const result = await exportChapterKeepsake(
      {
        title: 'August 2026',
        subtitle: '2 memories',
        filename: 'august',
        members: [
          noteMember('n1', '2026-08-02T12:00:00.000Z'),
          photoMember('p1', '/v1/media/abc/object?variant=display', '2026-08-10T12:00:00.000Z'),
        ] as never,
      },
      { assets: assets.deps, export: exporter }
    );

    expect(result).toEqual({ status: 'shared' });
    // Authenticated path received the app-relative media path…
    expect(assets.downloaded).toEqual(['/v1/media/abc/object?variant=display']);
    // …and the printed document inlines the export-sized derivative only.
    expect(printedHtml).toContain('data:image/jpeg;base64,base64-for-export-src-0.bin');
    expect(printedHtml).not.toContain('/v1/media/');
    expect(printedHtml).not.toContain('file://');
  });

  it('reduces high-resolution sources per the export bound before embedding', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const assets = assetDeps();
    const exporter = exportDeps();

    await exportChapterKeepsake(
      {
        title: 'T',
        subtitle: '1 memory',
        filename: 't',
        members: [photoMember('p1', '/v1/media/big/object', '2026-08-10T12:00:00.000Z')] as never,
      },
      { assets: assets.deps, export: exporter }
    );

    // The transform ran against the staged temp copy — the original memory
    // asset URI itself was never written to or mutated.
    expect(assets.transformed).toEqual(['file:///cache/keepsakes/assets/export-src-0.bin']);
    expect(assets.written.map((file) => file.name)).toEqual(['export-src-0.bin']);
  });

  it('reads local file photos through the same pipeline (one representation)', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const assets = assetDeps();
    const exporter = exportDeps();
    let printedHtml = '';
    exporter.printToFile.mockImplementation(async (html: string) => {
      printedHtml = html;
      return { uri: 'file:///cache/print.pdf' };
    });

    await exportChapterKeepsake(
      {
        title: 'T',
        subtitle: '1 memory',
        filename: 't',
        members: [photoMember('p1', 'file:///local/photo.jpg', '2026-08-10T12:00:00.000Z')] as never,
      },
      { assets: assets.deps, export: exporter }
    );

    expect(assets.downloaded).toHaveLength(0);
    expect(assets.transformed).toEqual(['file:///local/photo.jpg']);
    expect(printedHtml).toContain('data:image/jpeg;base64,');
    expect(printedHtml).not.toContain('file://');
  });

  it('downloads and processes each duplicate source once', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const assets = assetDeps();
    const exporter = exportDeps();

    await exportChapterKeepsake(
      {
        title: 'T',
        subtitle: '3 memories',
        filename: 't',
        members: [
          photoMember('p1', '/v1/media/same/object', '2026-08-10T12:00:00.000Z'),
          photoMember('p2', '/v1/media/same/object', '2026-08-11T12:00:00.000Z'),
          photoMember('p3', '/v1/media/other/object', '2026-08-12T12:00:00.000Z'),
        ] as never,
      },
      { assets: assets.deps, export: exporter }
    );

    expect(assets.downloaded).toEqual(['/v1/media/same/object', '/v1/media/other/object']);
    expect(assets.transformed).toHaveLength(2);
  });

  it('failed transform fails export honestly with temps cleaned', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const assets = assetDeps({
      transformPhoto: vi.fn(async () => {
        throw new Error('decode failed');
      }),
    });
    const exporter = exportDeps();

    const result = await exportChapterKeepsake(
      {
        title: 'T',
        subtitle: '1 memory',
        filename: 't',
        members: [photoMember('p1', '/v1/media/a/object', '2026-08-10T12:00:00.000Z')] as never,
      },
      { assets: assets.deps, export: exporter }
    );

    expect(result).toEqual({ status: 'failed', error: 'decode failed' });
    expect(exporter.printToFile).not.toHaveBeenCalled();
    expect(exporter.shareFile).not.toHaveBeenCalled();
    expect(assets.removed).toEqual([[`file:///cache/keepsakes/assets/export-src-0.bin`]]);
  });

  it('a 401/403 media fetch fails export honestly', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const assets = assetDeps({
      downloadAuthed: vi.fn(async () => {
        const error = new Error('Media request failed: 403') as Error & { status: number };
        error.status = 403;
        throw error;
      }),
    });
    const exporter = exportDeps();

    const result = await exportChapterKeepsake(
      {
        title: 'T',
        subtitle: '1 memory',
        filename: 't',
        members: [photoMember('p1', '/v1/media/forbidden/object', '2026-08-10T12:00:00.000Z')] as never,
      },
      { assets: assets.deps, export: exporter }
    );

    expect(result).toEqual({ status: 'failed', error: 'Media request failed: 403' });
    expect(exporter.printToFile).not.toHaveBeenCalled();
  });

  it('cleans temp files after share, cancel, and failure alike', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');

    for (const shareOutcome of ['shared', 'cancelled', 'failed'] as const) {
      const assets = assetDeps();
      const exporter = exportDeps(
        shareOutcome === 'cancelled'
          ? {
              shareFile: async () => {
                throw new Error('User dismissed the share sheet');
              },
            }
          : shareOutcome === 'failed'
            ? {
                shareFile: async () => {
                  throw new Error('no app can open this');
                },
              }
            : {}
      );

      const result = await exportChapterKeepsake(
        {
          title: 'T',
          subtitle: '1 memory',
          filename: 't',
          members: [photoMember('p1', '/v1/media/a/object', '2026-08-10T12:00:00.000Z')] as never,
        },
        { assets: assets.deps, export: exporter }
      );

      expect(result.status).toBe(shareOutcome);
      expect(assets.removed.flat()).toContain(`file:///cache/keepsakes/assets/export-src-0.bin`);
    }
  });

  it('rejects over-limit chapters explicitly instead of partial PDFs', async () => {
    const { exportChapterKeepsake } = await import(
      '@/features/export/keepsake-export'
    );
    const { MAX_EXPORT_PHOTOS } = await import('@/features/export/keepsake-assets');
    expect(MAX_EXPORT_PHOTOS).toBeLessThanOrEqual(40);
    const assets = assetDeps();
    const exporter = exportDeps();

    const members = Array.from({ length: MAX_EXPORT_PHOTOS + 1 }, (_, index) =>
      photoMember(`p${index}`, `/v1/media/m${index}/object`, '2026-08-10T12:00:00.000Z')
    );
    const result = await exportChapterKeepsake(
      { title: 'T', subtitle: `${members.length} memories`, filename: 't', members: members as never },
      { assets: assets.deps, export: exporter }
    );

    expect(result.status).toBe('failed');
    expect(assets.downloaded).toHaveLength(0);
    expect(exporter.printToFile).not.toHaveBeenCalled();
  });

  it('makes nothing public and creates no backend state', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const assets = assetDeps();
    const exporter = exportDeps();
    let printedHtml = '';
    exporter.printToFile.mockImplementation(async (html: string) => {
      printedHtml = html;
      return { uri: 'file:///cache/print.pdf' };
    });
    apiFetchSpy.mockClear();

    await exportChapterKeepsake(
      {
        title: 'T',
        subtitle: '1 memory',
        filename: 't',
        members: [photoMember('p1', '/v1/media/a/object', '2026-08-10T12:00:00.000Z')] as never,
      },
      { assets: assets.deps, export: exporter }
    );

    expect(apiFetchSpy).not.toHaveBeenCalled();
    expect(printedHtml).not.toMatch(/presigned|share-url|public-bucket|X-Amz-/i);
  });
});

describe('keepsake native temp cleanup (Astra #9)', () => {
  it('removeExportTempFiles deletes every uri through the native FS', async () => {
    const { removeExportTempFiles } = await import('@/features/export/keepsake-assets');
    const fs = await import('expo-file-system');
    const FileMock = fs.File as unknown as { deleted: string[] };
    FileMock.deleted = [];
    await removeExportTempFiles(['file:///cache/a.bin', 'file:///cache/b.bin']);
    expect(FileMock.deleted).toEqual(['file:///cache/a.bin', 'file:///cache/b.bin']);
  });

  it('removeExportTempFiles never throws and keeps deleting after a failure', async () => {
    const { removeExportTempFiles } = await import('@/features/export/keepsake-assets');
    const fs = await import('expo-file-system');
    const FileMock = fs.File as unknown as {
      deleted: string[];
      prototype: { delete(): void };
    };
    FileMock.deleted = [];
    const origDelete = FileMock.prototype.delete;
    FileMock.prototype.delete = function (this: { uri: string }) {
      if (this.uri === 'file:///cache/boom.bin') {
        throw new Error('locked');
      }
      return origDelete.call(this);
    };
    try {
      await expect(
        removeExportTempFiles(['file:///cache/boom.bin', 'file:///cache/ok.bin'])
      ).resolves.toBeUndefined();
      expect(FileMock.deleted).toContain('file:///cache/ok.bin');
    } finally {
      FileMock.prototype.delete = origDelete;
    }
  });

  it('exportKeepsakePdf removes the print temp but retains the placed PDF', async () => {
    const deps = makeDeps();
    const result = await exportKeepsakePdf('<html>hi</html>', 'august-2026', deps);
    expect(result).toEqual({ status: 'shared' });
    expect(deps.calls.tempRemoved).toEqual([['file:///cache/print.pdf']]);
    expect(deps.calls.tempRemoved.flat()).not.toContain('file:///cache/keepsakes/august-2026.pdf');
    // Bounded retention: rotation still runs at the start of every export.
    expect(deps.calls.rotations).toBe(1);
  });

  it('exportKeepsakePdf removes the print temp on staging failure too', async () => {
    const deps = makeDeps({
      placeFile: async () => {
        throw new Error('disk full');
      },
    });
    const result = await exportKeepsakePdf('<html>hi</html>', 'x', deps);
    expect(result.status).toBe('failed');
    expect(deps.calls.tempRemoved).toEqual([['file:///cache/print.pdf']]);
  });

  it('exportChapterKeepsake cleans staged intermediates on success and cancel', async () => {
    const { exportChapterKeepsake } = await import('@/features/export/keepsake-export');
    const members = [
      {
        id: 'n1',
        type: 'note' as const,
        title: '',
        body: 'Just words.',
        occurredAt: '2026-08-02T12:00:00.000Z',
        targetAt: null,
        createdAt: '2026-08-02T12:00:00.000Z',
        authorId: 'user_you',
        authorRole: 'you' as const,
        authorName: 'You',
        mediaPreview: null,
        audioUri: null,
      },
    ];
    const input = { title: 'August 2026', subtitle: '1 memory', filename: 'august', members };

    const removed: string[][] = [];
    const assets = {
      downloadAuthed: vi.fn(async () => ({ bytes: new Uint8Array([9]), contentType: 'image/jpeg', status: 200 })),
      downloadPublic: vi.fn(async () => ({ bytes: new Uint8Array([7]), contentType: 'image/png', status: 200 })),
      writeTempFile: vi.fn(async (name: string) => `file:///cache/assets/${name}`),
      transformPhoto: vi.fn(async (uri: string) => ({
        base64: 'aGk=',
        width: 100,
        height: 100,
        tempUris: [uri, 'file:///cache/derived.jpg'],
      })),
      removeTempFiles: vi.fn(async (uris: string[]) => {
        removed.push(uris);
      }),
    };

    const okExporter = makeDeps();
    const ok = await exportChapterKeepsake(input, { assets, export: okExporter });
    expect(ok).toEqual({ status: 'shared' });
    expect(removed.length).toBeGreaterThan(0);

    removed.length = 0;
    const cancelExporter = makeDeps({
      shareFile: async () => {
        throw new Error('User dismissed the share sheet');
      },
    });
    const cancelled = await exportChapterKeepsake(input, { assets, export: cancelExporter });
    expect(cancelled).toEqual({ status: 'cancelled' });
    expect(removed.length).toBeGreaterThan(0);
  });
});
