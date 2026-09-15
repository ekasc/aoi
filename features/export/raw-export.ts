import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { apiFetch, getApiBaseUrl, getApiTokens } from '@/features/api-client';
import { ZipStoreWriter, type ZipAppendSink } from '@/features/export/zip-store';

/**
 * Free raw data export (Astra #12) — NOT the Plus PDF keepsake.
 *
 * A user-initiated, local-only archive of everything the caller is
 * currently authorized to read: one ZIP with manifest.json, one JSON part
 * per dataset, and original media bytes under media/. Generation happens
 * on-device from the same authenticated endpoints the app already uses,
 * so every pairing-isolation, sealed-letter, tombstone, and archived-space
 * rule is enforced server-side with zero new backend surface:
 * - no active Space (non-member, archived, deleted) → honest failure;
 * - sealed letter bodies arrive only when the API includes them (opened);
 * - purged account fields never appear (the API never returns them);
 * - Plus state is never consulted — Free and Plus export identically.
 *
 * No public links, no server-persisted artifact, no export row/job.
 * Media streams (one file in RAM at a time; ZIP appends to disk), and a
 * media object that cannot be retrieved becomes an explicit manifest
 * errors[] entry — never a silent omission.
 *
 * Lifecycle (same bounded-final-artifact strategy as the PDF keepsake):
 * intermediate media temps are deleted immediately as the export settles,
 * but the final ZIP is RETAINED after the share sheet is presented —
 * receiving apps may read lazily after the share promise resolves
 * (notably Android). Prior final ZIPs rotate at the start of the next
 * export (at most one retained), and a ZIP never handed to the share
 * sheet (build/fetch failure, sharing unavailable) is deleted
 * immediately. Nothing durable: everything lives in cache.
 */

export const RAW_EXPORT_VERSION = 1;
/** Moments pages of 100; past this the Space is too large for one export. */
const MAX_MOMENT_PAGES = 200;
const MOMENT_PAGE_SIZE = 100;
const CALENDAR_WINDOW = {
  from: '2000-01-01T00:00:00.000Z',
  to: '2100-01-01T00:00:00.000Z',
};

export type RawExportResult =
  | { status: 'shared'; mediaErrors: number }
  /** Share-sheet dismissal. Not an error — show nothing alarming. */
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

export type RawExportMediaError = {
  mediaId: string;
  file: string;
  message: string;
};

export type RawExportManifest = {
  exportVersion: number;
  generatedAt: string;
  exportedByUserId: string;
  spaceId: string;
  datasets: {
    moments: number;
    calendarEvents: number;
    proposals: number;
    somedayItems: number;
    importedMilestones: number;
    letters: number;
    mediaFiles: number;
  };
  /** Media objects that could not be retrieved — explicit, never silent. */
  errors: RawExportMediaError[];
};

export type RawExportFs = {
  /**
   * Bounded retention: delete prior final ZIPs (and stray temp dirs from
   * crashed runs) at the start of each export. Hygiene — never throws.
   */
  rotatePriorExports: () => Promise<void>;
  createStaging: () => Promise<{ tmpDirUri: string; zipUri: string; mediaUri: (name: string) => string }>;
  openZipSink: (zipUri: string) => Promise<ZipAppendSink & { close: () => Promise<void> }>;
  readChunk: (uri: string, offset: number, length: number) => Promise<Uint8Array>;
  fileSize: (uri: string) => Promise<number>;
  deleteFile: (uri: string) => Promise<void>;
  /** Remove the intermediate temp dir (media staging). Never throws. */
  removeTempDir: (tmpDirUri: string) => Promise<void>;
};

export type RawExportDeps = {
  fetchJson: (path: string) => Promise<unknown>;
  /** Authenticated byte download, streaming to destUri (bounded RAM). */
  downloadMediaToFile: (url: string, destUri: string) => Promise<{ sizeBytes: number; contentType: string | null }>;
  fs: RawExportFs;
  isSharingAvailable: () => Promise<boolean>;
  shareFile: (uri: string) => Promise<void>;
  now: () => Date;
};

type ExportMoment = {
  id: string;
  type: string;
  mediaId?: string | null;
  audioUri?: string | null;
};

function safeSegment(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return cleaned || fallback;
}

function isCancelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|dismiss/i.test(message);
}

function extensionForContentType(contentType: string | null, url: string): string {
  const fromType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
  };
  const base = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (fromType[base]) return fromType[base];
  const match = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url);
  return match ? match[1].toLowerCase() : 'bin';
}

/** Original-bytes serve path for a media object id (authenticated read). */
export function rawMediaServePath(mediaId: string): string {
  return `/v1/media/${encodeURIComponent(mediaId)}/object?variant=original`;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function pickSpaceExport(space: Record<string, unknown>): Record<string, unknown> {
  // Deliberately drops inviteCode: a join credential is not archive data.
  const { inviteCode: _dropped, ...rest } = space;
  void _dropped;
  return rest;
}

function defaultDeps(): RawExportDeps {
  return {
    fetchJson: (path: string) => apiFetch<unknown>(path),
    downloadMediaToFile: async (url: string, destUri: string) => {
      const base = getApiBaseUrl();
      if (!url.startsWith(base)) {
        // The Bearer token must never leave the app origin.
        throw new Error('Refusing to fetch media outside the Aoi API origin.');
      }
      const token = getApiTokens()?.accessToken;
      if (!token) {
        throw new Error('You are signed out. Sign in and try again.');
      }
      const file = await File.downloadFileAsync(
        url,
        new File(destUri),
        { headers: { Authorization: `Bearer ${token}` }, idempotent: true }
      );
      return { sizeBytes: file.size, contentType: null };
    },
    fs: {
      createStaging: async () => {
        const exportsDir = new Directory(Paths.cache, 'raw-exports');
        if (!exportsDir.exists) {
          exportsDir.create();
        }
        const stamp = Date.now();
        const tmp = new Directory(exportsDir, `tmp-${stamp}`);
        if (!tmp.exists) {
          tmp.create();
        }
        return {
          tmpDirUri: tmp.uri,
          zipUri: new File(exportsDir, `aoi-export-${stamp}.zip`).uri,
          mediaUri: (name: string) => new File(tmp, name).uri,
        };
      },
      rotatePriorExports: async () => {
        try {
          const exportsDir = new Directory(Paths.cache, 'raw-exports');
          if (!exportsDir.exists) {
            return;
          }
          for (const entry of exportsDir.list()) {
            const base = entry.uri.split('/').pop() ?? '';
            if (entry instanceof File && /^aoi-export-.*\.zip$/.test(base)) {
              entry.delete();
            } else if (entry instanceof Directory && base.startsWith('tmp-')) {
              entry.delete();
            }
          }
        } catch {
          // Rotation is hygiene, never a failure.
        }
      },
      openZipSink: async (zipUri: string) => {
        const file = new File(zipUri);
        file.create({ overwrite: true });
        const handle = file.open();
        let position = 0;
        return {
          writeBytes: (chunk: Uint8Array) => {
            handle.offset = position;
            handle.writeBytes(chunk);
            position += chunk.length;
          },
          patchBytes: (offset: number, chunk: Uint8Array) => {
            handle.offset = offset;
            handle.writeBytes(chunk);
            handle.offset = position;
          },
          close: async () => {
            handle.close();
          },
        };
      },
      readChunk: async (uri: string, offset: number, length: number) => {
        const handle = new File(uri).open();
        try {
          handle.offset = offset;
          return handle.readBytes(length);
        } finally {
          handle.close();
        }
      },
      fileSize: async (uri: string) => new File(uri).size,
      deleteFile: async (uri: string) => {
        new File(uri).delete();
      },
      removeTempDir: async (tmpDirUri: string) => {
        try {
          new Directory(tmpDirUri).delete();
        } catch {
          // Temp cleanup is hygiene, never a failure.
        }
      },
    },
    isSharingAvailable: () => Sharing.isAvailableAsync(),
    shareFile: async (uri: string) => {
      await Sharing.shareAsync(uri, { mimeType: 'application/zip' });
    },
    now: () => new Date(),
  };
}

export async function exportRawArchive(
  input: { userId: string },
  deps: RawExportDeps = defaultDeps()
): Promise<RawExportResult> {
  if (!input.userId) {
    return { status: 'failed', error: 'You are signed out. Sign in and try again.' };
  }
  let staging: { tmpDirUri: string; zipUri: string; mediaUri: (name: string) => string } | null = null;
  let sink: (ZipAppendSink & { close: () => Promise<void> }) | null = null;
  const fail = async (error: string): Promise<RawExportResult> => ({ status: 'failed', error });
  try {
    await deps.fs.rotatePriorExports();
  } catch {
    // Rotation already best-effort inside; belt-and-braces.
  }
  try {
    staging = await deps.fs.createStaging();
  } catch {
    return fail('Could not prepare the export. Please try again.');
  }
  // The partial ZIP was never handed to the share sheet: remove it
  // immediately along with the media temps.
  const discardPartial = async (): Promise<void> => {
    try {
      await deps.fs.deleteFile(staging!.zipUri);
    } catch {
      // Backstopped by next-export rotation.
    }
    await deps.fs.removeTempDir(staging!.tmpDirUri);
  };
  try {
    const generatedAt = deps.now();
    const spaceRes = (await deps.fetchJson('/v1/spaces/current')) as {
      space: Record<string, unknown> | null;
    };
    if (!spaceRes?.space || typeof spaceRes.space.id !== 'string') {
      throw new Error('There is no active Space to export.');
    }
    const spaceId = spaceRes.space.id;
    const spacePart = pickSpaceExport(spaceRes.space);

    // Moments page to completion (keyset cursor, bounded page count).
    const moments: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_MOMENT_PAGES; page += 1) {
      const path =
        `/v1/spaces/current/moments?limit=${MOMENT_PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = (await deps.fetchJson(path)) as { moments?: unknown[]; nextCursor?: string };
      moments.push(...asArray(res.moments));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
      if (page === MAX_MOMENT_PAGES - 1) {
        throw new Error('This Space is too large to export on this device.');
      }
    }

    const events = (await deps.fetchJson(
      `/v1/spaces/current/calendar/events?from=${encodeURIComponent(CALENDAR_WINDOW.from)}&to=${encodeURIComponent(CALENDAR_WINDOW.to)}`
    )) as unknown;
    const proposalsRes = (await deps.fetchJson('/v1/spaces/current/proposals')) as {
      proposals?: unknown[];
    };
    const somedayRes = (await deps.fetchJson('/v1/spaces/current/someday')) as { items?: unknown[] };
    const milestones = (await deps.fetchJson('/v1/spaces/current/imported-milestones')) as unknown;
    const question = (await deps.fetchJson('/v1/spaces/current/question')) as unknown;
    // Shelf shape exactly as the API authorizes it: sealed bodies absent.
    const lettersRes = (await deps.fetchJson('/v1/spaces/current/letters')) as { letters?: unknown[] };

    const base = getApiBaseUrlSafe();
    const mediaTargets: { mediaId: string; url: string }[] = [];
    const seenMedia = new Set<string>();
    for (const moment of moments) {
      const m = moment as ExportMoment;
      if (m.type === 'media' && typeof m.mediaId === 'string' && m.mediaId && !seenMedia.has(m.mediaId)) {
        seenMedia.add(m.mediaId);
        mediaTargets.push({ mediaId: m.mediaId, url: `${base}${rawMediaServePath(m.mediaId)}` });
      }
      if (typeof m.audioUri === 'string' && m.audioUri.startsWith('/') && !seenMedia.has(`audio:${m.audioUri}`)) {
        seenMedia.add(`audio:${m.audioUri}`);
        mediaTargets.push({ mediaId: `audio-${m.id}`, url: `${base}${m.audioUri}` });
      }
    }

    sink = await deps.fs.openZipSink(staging.zipUri);
    const zip = new ZipStoreWriter(sink, generatedAt);
    const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value, null, 2));
    await zip.addBytes('space.json', encode(spacePart));
    await zip.addBytes('moments.json', encode(moments));
    await zip.addBytes('calendar-events.json', encode(events));
    await zip.addBytes('proposals.json', encode(proposalsRes?.proposals ?? []));
    await zip.addBytes('someday.json', encode(somedayRes?.items ?? []));
    await zip.addBytes('milestones.json', encode(milestones));
    await zip.addBytes('question.json', encode(question));
    await zip.addBytes('letters.json', encode(lettersRes?.letters ?? []));

    // Media sequentially: one file on disk staged, streamed chunk-wise
    // into the archive, temp removed before the next begins.
    const errors: RawExportMediaError[] = [];
    let index = 0;
    for (const target of mediaTargets) {
      const tempName = `media-${index}.bin`;
      const fileName = `media/${safeSegment(target.mediaId, `media-${index}`)}`;
      try {
        const tempUri = staging.mediaUri(tempName);
        const downloaded = await deps.downloadMediaToFile(target.url, tempUri);
        const size = await deps.fs.fileSize(tempUri);
        const ext = extensionForContentType(downloaded.contentType, target.url);
        const entryName = `${fileName}.${ext}`;
        const readChunk = deps.fs.readChunk;
        await zip.addStream(entryName, size, (offset, length) => readChunk(tempUri, offset, length));
      } catch (error) {
        errors.push({
          mediaId: target.mediaId,
          file: `${fileName}.bin`,
          message: error instanceof Error ? error.message : 'Media could not be retrieved.',
        });
      } finally {
        try {
          await deps.fs.deleteFile(staging.mediaUri(tempName));
        } catch {
          // Staging-dir removal below is the backstop.
        }
      }
      index += 1;
    }

    const manifest: RawExportManifest = {
      exportVersion: RAW_EXPORT_VERSION,
      generatedAt: generatedAt.toISOString(),
      exportedByUserId: input.userId,
      spaceId,
      datasets: {
        moments: moments.length,
        calendarEvents: asArray(events).length,
        proposals: asArray(proposalsRes?.proposals).length,
        somedayItems: asArray(somedayRes?.items).length,
        importedMilestones: asArray(milestones).length,
        letters: asArray(lettersRes?.letters).length,
        mediaFiles: mediaTargets.length - errors.length,
      },
      errors,
    };
    await zip.addBytes('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
    await zip.finish();
    await sink.close();
    sink = null;

    // Handed to the share sheet from here on: the final ZIP is RETAINED
    // (receiving apps may read lazily after the promise resolves) while
    // the media temps are always removed.
    try {
      if (!(await deps.isSharingAvailable())) {
        await discardPartial();
        return fail('Sharing is not available on this device.');
      }
      await deps.shareFile(staging.zipUri);
      await deps.fs.removeTempDir(staging.tmpDirUri);
      return { status: 'shared', mediaErrors: errors.length };
    } catch (error) {
      await deps.fs.removeTempDir(staging.tmpDirUri);
      if (isCancelError(error)) {
        return { status: 'cancelled' };
      }
      return fail(error instanceof Error ? error.message : 'Could not share the export.');
    }
  } catch (error) {
    try {
      await sink?.close();
    } catch {
      // Close is hygiene; partial discard below is the backstop.
    }
    sink = null;
    if (staging) {
      await discardPartial();
    }
    return fail(error instanceof Error ? error.message : 'Could not export your data.');
  }
}

function getApiBaseUrlSafe(): string {
  try {
    return getApiBaseUrl();
  } catch {
    return '';
  }
}
