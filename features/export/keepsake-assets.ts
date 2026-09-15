import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { apiFetchBytes, getApiBaseUrl, type ApiBytesResult } from '@/features/api-client';

/**
 * Export-sized image bounds. A4 printable width is 8.27in, so 1600px on the
 * long edge ≈ 190 DPI — crisp in print without hauling phone-full-res
 * bitmaps through the document. JPEG q0.8 lands typical photos at a few
 * hundred KB; the totals below keep even pathological chapters bounded.
 */
export const EXPORT_MAX_DIMENSION = 1600;
export const EXPORT_JPEG_QUALITY = 0.8;
/** Hard photo count per export — exceeded explicitly, never silently cut. */
export const MAX_EXPORT_PHOTOS = 40;
/** Hard cumulative base64 ceiling per export — exceeded explicitly. */
export const MAX_EXPORT_BASE64_BYTES = 64 * 1024 * 1024;

export type PhotoSource =
  | { kind: 'local'; uri: string }
  | { kind: 'authed'; uri: string; path: string }
  | { kind: 'public'; uri: string };

/**
 * Classify a chapter photo URI for export staging:
 * - app-local files are read directly (never mutated, never re-uploaded);
 * - app-origin URLs (relative `/v1/media/…` or absolute same-origin) need
 *   the current Aoi Bearer token — staged via apiFetchBytes, never exposed
 *   to the WebView;
 * - anything else downloads without credentials (no token ever leaves the
 *   app origin) so the WebView still never hits the network itself.
 */
export function classifyPhotoSource(uri: string): PhotoSource {
  if (uri.startsWith('file://')) {
    return { kind: 'local', uri };
  }
  if (uri.startsWith('/')) {
    return { kind: 'authed', uri, path: uri };
  }
  try {
    const base = getApiBaseUrl();
    if (uri.startsWith(base)) {
      return { kind: 'authed', uri, path: uri.slice(base.length) || '/' };
    }
    return { kind: 'public', uri };
  } catch {
    return { kind: 'public', uri };
  }
}

/**
 * Pure resize policy: constrain the LONG edge to EXPORT_MAX_DIMENSION,
 * preserving aspect. Smaller images pass through with no upscale.
 */
export function exportResizeAction(
  width: number,
  height: number
): { resize: { width?: number; height?: number } } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (Math.max(width, height) <= EXPORT_MAX_DIMENSION) {
    return null;
  }
  if (width >= height) {
    return { resize: { width: EXPORT_MAX_DIMENSION } };
  }
  return { resize: { height: EXPORT_MAX_DIMENSION } };
}

export type TransformedPhoto = {
  /** Inline document source — the ONLY photo representation in print HTML. */
  dataUri: string;
  /** Every temp file this transform created (source copy + derivatives). */
  tempUris: string[];
};

export type StagePhotosDeps = {
  downloadAuthed: (path: string) => Promise<ApiBytesResult>;
  downloadPublic: (uri: string) => Promise<ApiBytesResult>;
  /** Persist downloaded bytes as a temp source file; returns its uri. */
  writeTempFile: (name: string, bytes: Uint8Array) => Promise<string> | string;
  /**
   * Probe dimensions, render the export-sized JPEG, and return its base64
   * plus every temp file created along the way. Never mutates the input.
   */
  transformPhoto: (uri: string) => Promise<{ base64: string; width: number; height: number; tempUris: string[] }>;
  /** Best-effort removal of temp uris. Never throws. */
  removeTempFiles: (uris: string[]) => Promise<void> | void;
};

export type StagedPhotos = {
  /** Source uri → inline `data:image/jpeg;base64,…` document reference. */
  uriMap: Map<string, string>;
  /** Temp files that must be cleaned up when the export settles. */
  tempUris: string[];
  cleanup: () => Promise<void>;
};

/**
 * Production intermediate cleanup: delete every tracked temp file,
 * per-file best-effort (one stubborn temp never masks the export result
 * or aborts the remaining deletions). Idempotent — deleting twice is safe.
 */
export async function removeExportTempFiles(uris: string[]): Promise<void> {
  for (const uri of uris) {
    try {
      new File(uri).delete();
    } catch {
      // Hygiene, never a failure.
    }
  }
}

function defaultDeps(): StagePhotosDeps {
  const assetsDir = () => {
    const dir = new Directory(Paths.cache, 'keepsakes', 'assets');
    if (!dir.exists) {
      dir.create();
    }
    return dir;
  };
  return {
    downloadAuthed: (path: string) => apiFetchBytes(path),
    downloadPublic: async (uri: string) => {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(`Media request failed: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        contentType: response.headers?.get?.('content-type') ?? null,
        status: response.status,
      };
    },
    writeTempFile: async (name: string, bytes: Uint8Array) => {
      const dest = new File(assetsDir(), name);
      dest.write(bytes);
      return dest.uri;
    },
    transformPhoto: async (uri: string) => {
      const probed = await manipulateAsync(uri, []);
      const action = exportResizeAction(probed.width, probed.height);
      const rendered = await manipulateAsync(uri, action ? [action] : [], {
        compress: EXPORT_JPEG_QUALITY,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (!rendered.base64) {
        throw new Error('Photo encoding produced no data.');
      }
      return {
        base64: rendered.base64,
        width: rendered.width,
        height: rendered.height,
        tempUris: [probed.uri, rendered.uri],
      };
    },
    removeTempFiles: async (uris: string[]) => {
      await removeExportTempFiles(uris);
    },
  };
}

/**
 * Resolve every unique chapter photo to an inline data URI — sequentially,
 * one image in flight at a time. Authenticated app-origin assets travel the
 * Bearer path; nothing public is ever minted for them; originals are only
 * ever read.
 *
 * Failure is honest and total: an over-limit chapter, an undownloadable
 * asset, or a failed transform aborts with a clear message, and every temp
 * file staged so far is removed before the error propagates — no partial
 * keepsake is ever rendered.
 */
export async function stageChapterPhotos(
  sources: string[],
  deps: StagePhotosDeps = defaultDeps()
): Promise<StagedPhotos> {
  const unique = [...new Set(sources)];
  if (unique.length > MAX_EXPORT_PHOTOS) {
    throw new Error(
      `This chapter holds ${unique.length} photos; keepsake export supports up to ${MAX_EXPORT_PHOTOS}.`
    );
  }

  const uriMap = new Map<string, string>();
  const tempUris: string[] = [];
  let base64Total = 0;
  const cleanup = async () => {
    try {
      await deps.removeTempFiles(tempUris);
    } catch {
      // Cleanup is hygiene, never a failure.
    }
  };

  try {
    let index = 0;
    for (const source of unique) {
      if (uriMap.has(source)) {
        continue;
      }
      const classified = classifyPhotoSource(source);
      let transformInput = source;
      if (classified.kind !== 'local') {
        const downloaded =
          classified.kind === 'authed'
            ? await deps.downloadAuthed(classified.path)
            : await deps.downloadPublic(classified.uri);
        transformInput = await deps.writeTempFile(`export-src-${index}.bin`, downloaded.bytes);
        tempUris.push(transformInput);
      }
      const transformed = await deps.transformPhoto(transformInput);
      tempUris.push(...transformed.tempUris);
      base64Total += transformed.base64.length;
      if (base64Total > MAX_EXPORT_BASE64_BYTES) {
        throw new Error('This chapter’s photos exceed the keepsake size limit.');
      }
      uriMap.set(source, `data:image/jpeg;base64,${transformed.base64}`);
      index += 1;
    }
    return { uriMap, tempUris, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
