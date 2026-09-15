import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import {
  buildKeepsakeHtml,
  type KeepsakeEntryInput,
} from '@/features/export/keepsake-document';
import { stageChapterPhotos, removeExportTempFiles, type StagePhotosDeps } from '@/features/export/keepsake-assets';
import type { Moment } from '@/features/moments/types';

export type KeepsakeExportResult =
  | { status: 'shared' }
  /** The user dismissed the share sheet (or the platform reported a
   *  user-cancelled dismissal). Not an error — show nothing alarming. */
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

export type KeepsakeExportDeps = {
  printToFile: (html: string) => Promise<{ uri: string }>;
  /** Stage the printed PDF under a meaningful keepsake filename. */
  placeFile: (printedUri: string, filename: string) => Promise<string>;
  isSharingAvailable: () => Promise<boolean>;
  shareFile: (uri: string) => Promise<void>;
  /** Best-effort rotation of previous keepsake files. Never throws. */
  rotateOldFiles: () => Promise<void>;
  /**
   * Delete intermediate files (print-driver temp output). Best-effort,
   * never throws, never masks the export result. The PLACED final PDF is
   * never passed here — it stays in bounded cache for lazy share
   * consumers and rotates on the next export.
   */
  removeTempFiles: (uris: string[]) => Promise<void> | void;
};

function keepsakesDir(): Directory {
  return new Directory(Paths.cache, 'keepsakes');
}

function defaultDeps(): KeepsakeExportDeps {
  return {
    printToFile: async (html: string) => {
      const result = await Print.printToFileAsync({ html });
      return { uri: result.uri };
    },
    placeFile: async (printedUri: string, filename: string) => {
      const dir = keepsakesDir();
      if (!dir.exists) {
        dir.create();
      }
      const dest = new File(dir, `${filename}.pdf`);
      try {
        new File(printedUri).copy(dest);
      } catch (error) {
        // Never leave a failed partial output beside real keepsakes.
        try {
          dest.delete();
        } catch {
          // Hygiene, never a failure.
        }
        throw error;
      }
      return dest.uri;
    },
    isSharingAvailable: () => Sharing.isAvailableAsync(),
    shareFile: async (uri: string) => {
      await Sharing.shareAsync(uri);
    },
    removeTempFiles: async (uris: string[]) => {
      await removeExportTempFiles(uris);
    },
    rotateOldFiles: async () => {
      try {
        const dir = keepsakesDir();
        if (!dir.exists) {
          dir.create();
          return;
        }
        for (const entry of dir.list()) {
          if (entry instanceof File) {
            entry.delete();
          } else if (entry instanceof Directory) {
            for (const nested of entry.list()) {
              if (nested instanceof File) {
                nested.delete();
              }
            }
          }
        }
      } catch {
        // Cache rotation is hygiene, never a failure.
      }
    },
  };
}

function formatKeepsakeDate(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export type ChapterKeepsakeInput = {
  title: string;
  subtitle: string;
  filename: string;
  /** Authoritative range members, oldest-first. */
  members: Moment[];
};

function isCancelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|dismiss/i.test(message);
}

/**
 * End-to-end chapter export: resolve every photo through the authenticated
 * media path into local staged files, render the document against those
 * local references (the print WebView performs zero authenticated HTTP),
 * print/share, then remove every staged source photo — on success,
 * cancellation, and failure alike. The staged PDF itself rotates on the
 * next export; staged originals never outlive their export.
 */
export async function exportChapterKeepsake(
  input: ChapterKeepsakeInput,
  deps: {
    assets?: StagePhotosDeps;
    export?: KeepsakeExportDeps;
  } = {}
): Promise<KeepsakeExportResult> {
  // Unique photo assets in first-seen order (cover first, then entries).
  // Includes ordered image attachments for trace AND media (all photos),
  // with legacy mediaPreview fallback so old single-photo memories stay.
  const firstImageOf = (member: (typeof input.members)[number]): string | null => {
    const attached = (member.attachments ?? []).find((a) => a.kind === 'image');
    if (attached) return attached.url;
    return member.mediaPreview ?? null;
  };
  const allImagesOf = (member: (typeof input.members)[number]): string[] => {
    const attached = (member.attachments ?? []).filter((a) => a.kind === 'image').map((a) => a.url);
    if (attached.length > 0) return attached;
    return member.mediaPreview ? [member.mediaPreview] : [];
  };
  const coverMember = input.members.find(
    (member) => (member.type === 'media' || member.type === 'trace') && firstImageOf(member)
  );
  const coverPhoto = coverMember ? firstImageOf(coverMember) : null;
  const sources: string[] = [];
  if (coverPhoto) {
    sources.push(coverPhoto);
  }
  for (const member of input.members) {
    for (const uri of allImagesOf(member)) {
      if (!sources.includes(uri)) sources.push(uri);
    }
  }

  let staged: Awaited<ReturnType<typeof stageChapterPhotos>> | null = null;
  try {
    staged = await stageChapterPhotos(sources, deps.assets);
    const uriOf = (uri: string): string => staged?.uriMap.get(uri) ?? uri;
    const entries: KeepsakeEntryInput[] = input.members.map((member) => {
      const date = formatKeepsakeDate(member.occurredAt);
      const firstImage = firstImageOf(member);
      if ((member.type === 'media' || member.type === 'trace') && firstImage) {
        return {
          kind: 'photo',
          date,
          title: member.title.trim() || null,
          uri: uriOf(firstImage),
        };
      }
      if (member.type === 'trace') {
        return { kind: 'voice', date, title: member.title.trim() || null };
      }
      return { kind: 'note', date, title: member.title.trim() || null, body: member.body };
    });
    const html = buildKeepsakeHtml({
      cover: {
        title: input.title,
        subtitle: input.subtitle,
        dateLine: input.title,
        photoUri: coverPhoto ? uriOf(coverPhoto) : null,
      },
      entries,
    });
    return await exportKeepsakePdf(html, input.filename, deps.export);
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Could not export this keepsake.',
    };
  } finally {
    await staged?.cleanup();
  }
}

/**
 * Render HTML to a local PDF and hand it to the system share sheet.
 *
  * Privacy: user-initiated only; the file lives in the app cache (never
  * uploaded anywhere — this module performs zero network calls); previous
  * keepsakes are rotated on each export and the OS may purge the cache.
  * The print-driver temp is removed once staged; only the placed final
  * PDF is retained (bounded, for lazy share consumers).
 * No chapter/content DB rows are created — export is a rendering operation.
 *
 * Cancellation (share-sheet dismissal, where the platform reports it as an
 * error) resolves as `cancelled`, distinctly from `failed`. Note a platform
 * limitation: iOS resolves normally on dismiss, so some cancellations
 * report as `shared` — the file still only exists locally either way.
 */
export async function exportKeepsakePdf(
  html: string,
  filename: string,
  deps: KeepsakeExportDeps = defaultDeps()
): Promise<KeepsakeExportResult> {
  if (!html.trim()) {
    return { status: 'failed', error: 'Nothing to export.' };
  }
  const safeName = filename.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 80) || 'keepsake';

  try {
    await deps.rotateOldFiles();
  } catch {
    // Rotation already best-effort inside; this is belt-and-braces.
  }

  let printedUri: string;
  try {
    const printed = await deps.printToFile(html);
    try {
      printedUri = await deps.placeFile(printed.uri, safeName);
    } finally {
      // The print-driver temp is an intermediate in every outcome; the
      // placed final PDF is retained (bounded rotation, lazy consumers).
      try {
        await deps.removeTempFiles([printed.uri]);
      } catch {
        // Hygiene, never a failure.
      }
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Could not render this keepsake.',
    };
  }

  try {
    const available = await deps.isSharingAvailable();
    if (!available) {
      return { status: 'failed', error: 'Sharing is not available on this device.' };
    }
    await deps.shareFile(printedUri);
    return { status: 'shared' };
  } catch (error) {
    if (isCancelError(error)) {
      return { status: 'cancelled' };
    }
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Could not share this keepsake.',
    };
  }
}
