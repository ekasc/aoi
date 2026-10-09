import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { AlbumMediaRecord } from '@aoi/shared';

import { createAlbumPhotoStore, type AlbumPhotoStore } from '@/features/album/album-photo-store';
import {
  establishAlbumSession,
  openPhoto,
  sealAndUploadPhoto,
  type AlbumSessionReady,
} from '@/features/album/album-session';
import {
  ProtocolUploadInterrupted,
  establishProtocolArchive,
  readProtocolArchive,
  removeProtocolPhoto,
  uploadProtocolPhoto,
  type ProtocolArchiveReady,
} from '@/features/album/protocol-archive';
import { prepareSkyPhoto } from '@/features/album/sky-photo-import';
import { readPendingUploads } from '@/features/album/protocol-upload-journal';
import { SKY_PHOTO_BATCH_LIMIT, releaseSelectedSkyPhotos, skyPhotoScopeKey, type SelectedSkyPhoto, type SkyPhoto } from '@/features/album/sky-photo-repository';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

/**
 * The Us sky, backed by the shared encrypted album.
 *
 * Two formats are read side by side and never reinterpreted as each other:
 *
 *   signed    media with a manifest, authenticated before it is shown, removed
 *             with a signed tombstone.
 *   legacy    media sealed under the old device-derived key, read through its
 *             own path and left exactly as it is.
 *
 * Signed initialisation does not depend on the legacy session being ready. A
 * Space with no legacy partner is exactly where the signed protocol is the only
 * thing that works, so waiting on the old path would strand a new Space.
 *
 * A trust failure is never a silent downgrade. Legacy media still shows — it is
 * real media — but the failure is surfaced, because "we could not verify your
 * archive" and "you have no archive" must not look the same.
 */

export type ProtocolStatus =
  /** No signed archive initialised yet. */
  | 'none'
  /** Claimed an id; waiting for a verified device to enrol this one. */
  | 'waiting'
  /**
   * Joining, and nothing here has verified the root yet. The screen shows the
   * fingerprint and asks a human to confirm it before anything is pinned.
   */
  | 'unverified'
  /** Established and trusted. */
  | 'ready'
  /** The server could not be reached. Retry. */
  | 'unavailable'
  /** A trust mismatch or invalid protocol state. Not retryable, never ignored. */
  | 'blocked';

type PhotoRead = {
  scopeKey: string | null;
  photos: SkyPhoto[];
  status: 'loading' | 'ready' | 'failed';
  error: string | null;
  revision: number;
};

type SessionBundle = {
  scopeKey: string;
  session: AlbumSessionReady | null;
  protocol: ProtocolArchiveReady | null;
  protocolStatus: ProtocolStatus;
  /** Signed media this device currently shows, with its manifest revision. */
  protocolRevisions: Map<string, number>;
  /** The plaintext of those photos, so one cache serves both formats. */
  protocolBytes: Map<string, Uint8Array>;
  store: AlbumPhotoStore;
};

const READ_ERROR = 'Could not open your shared photos. Please try again.';
const TRUST_ERROR = 'We could not verify your shared archive on this device.';
const ADD_ERROR = 'Could not add these photos. Please try again.';
const REMOVE_ERROR = 'Could not finish removing this photo. Please try again.';

/** A signed photo, dressed as a legacy record so one cache serves both. */
function protocolRecord(photo: {
  mediaId: string;
  addedAt: string;
  width?: number;
  height?: number;
  bytes: Uint8Array;
}): AlbumMediaRecord {
  return {
    id: photo.mediaId,
    createdAt: photo.addedAt,
    byteLength: photo.bytes.length,
    mimeType: 'image/jpeg',
    ...(photo.width !== undefined ? { width: photo.width } : {}),
    ...(photo.height !== undefined ? { height: photo.height } : {}),
    wrappedKey: { nonce: '', ciphertext: '' },
    sealedNonce: '',
  };
}

/** Finish anything a previous run left half-done, under its original media id. */
async function resumePendingUploads(bundle: SessionBundle): Promise<void> {
  if (!bundle.protocol) return;
  for (const entry of await readPendingUploads(bundle.scopeKey)) {
    try {
      await uploadProtocolPhoto(
        bundle.protocol,
        { uri: entry.uri, width: entry.width, height: entry.height },
        { resume: entry, scopeKey: bundle.scopeKey }
      );
    } catch {
      // Still unfinished. The journal keeps it for the next run.
    }
  }
}

/**
 * Everything this device may show, in one pass, and whether that is the whole
 * archive. Signed media is verified first, so the cache only ever receives
 * media that passed its checks.
 */
async function loadBundlePhotos(
  bundle: SessionBundle,
  shown: Map<string, SkyPhoto>
): Promise<{ photos: SkyPhoto[]; missing: string[] }> {
  const records = bundle.session ? await bundle.session.client.list() : [];
  if (!bundle.protocol) {
    return { photos: await bundle.store.list(records), missing: [] };
  }

  const read = await readProtocolArchive(bundle.protocol);
  bundle.protocolRevisions.clear();
  bundle.protocolBytes.clear();
  for (const photo of read.photos) {
    bundle.protocolBytes.set(photo.mediaId, photo.bytes);
    bundle.protocolRevisions.set(photo.mediaId, 1);
  }

  // A download that failed keeps the copy this device already showed. It is
  // neither a deletion nor a rejection, so it must not vanish from the sky —
  // and keeping it in the revision map is what stops the eviction below.
  const carried: SkyPhoto[] = [];
  for (const id of read.missing) {
    const already = shown.get(id);
    if (already) {
      carried.push(already);
      bundle.protocolRevisions.set(id, 1);
    }
  }

  const photos = await bundle.store.list([...read.photos.map(protocolRecord), ...records]);
  return { photos: [...photos, ...carried], missing: read.missing };
}

export function useSkyPhotos() {
  const { user } = useSession();
  const { space } = useSpace();
  const userId = user?.id;
  const spaceId = space?.id;
  const scopeKey = useMemo(() => (userId && spaceId ? skyPhotoScopeKey({ userId, spaceId }) : null), [userId, spaceId]);
  const currentScope = useRef(scopeKey);
  useLayoutEffect(() => { currentScope.current = scopeKey; }, [scopeKey]);
  const operationRef = useRef<string | null>(null);
  const readSequence = useRef(0);
  const bundleRef = useRef<SessionBundle | null>(null);
  /** What this device is currently showing, so an outage can keep it. */
  const shownRef = useRef(new Map<string, SkyPhoto>());
  const [revision, setRevision] = useState(0);
  const [stored, setStored] = useState<PhotoRead>({ scopeKey: null, photos: [], status: 'loading', error: null, revision: 0 });
  const [operation, setOperation] = useState<{ scopeKey: string | null; kind: 'importing' | 'removing' } | null>(null);
  const [actionError, setActionError] = useState<{ scopeKey: string | null; message: string } | null>(null);
  const [protocolState, setProtocolState] = useState<{ scopeKey: string | null; status: ProtocolStatus } | null>(null);

  const reload = useCallback(() => {
    if (operationRef.current !== scopeKey) {
      operationRef.current = scopeKey;
      setRevision((current) => current + 1);
    }
  }, [scopeKey]);

  useEffect(() => {
    currentScope.current = scopeKey;
    const sequence = ++readSequence.current;
    if (!userId || !spaceId || !scopeKey) {
      setStored({ scopeKey: null, photos: [], status: 'loading', error: null, revision });
      setProtocolState(null);
      return;
    }
    operationRef.current = scopeKey;
    void (async () => {
      try {
        // The signed archive is initialised regardless of whether the legacy
        // session found a partner: a Space with no legacy partner is exactly
        // where the signed protocol is the only path that works. The legacy
        // session is awaited first only so its own timing is unchanged.
        const legacy = await establishAlbumSession({ userId, spaceId });
        if (currentScope.current !== scopeKey || readSequence.current !== sequence) return;
        const session = legacy.status === 'ready' ? legacy : null;

        const archive = await establishProtocolArchive({ spaceId });
        if (currentScope.current !== scopeKey || readSequence.current !== sequence) return;

        const protocol = archive.status === 'ready' ? archive : null;
        setProtocolState({ scopeKey, status: archive.status });

        const protocolBytes = new Map<string, Uint8Array>();
        const protocolRevisions = new Map<string, number>();
        const store = createAlbumPhotoStore({
          spaceId,
          fetchObject: async (id) =>
            protocolBytes.get(id) ?? (session ? session.client.fetchObject(id) : new Uint8Array()),
          open: (record, bytes) =>
            protocolBytes.has(record.id) || !session
              ? bytes
              : openPhoto(session.spaceKey, record, bytes),
        });
        const bundle: SessionBundle = {
          scopeKey,
          session,
          protocol,
          protocolStatus: archive.status,
          protocolRevisions,
          protocolBytes,
          store,
        };

        await resumePendingUploads(bundle);
        const { photos } = await loadBundlePhotos(bundle, shownRef.current);

        // Authenticated deletion evicts the cached plaintext. A download that
        // failed is not a deletion — it is carried in `protocolRevisions`, so
        // the loop below leaves it alone.
        const previous = bundleRef.current;
        if (previous && previous.scopeKey === scopeKey) {
          for (const id of previous.protocolRevisions.keys()) {
            if (!protocolRevisions.has(id)) await store.removeCached(id);
          }
        }

        if (currentScope.current !== scopeKey || readSequence.current !== sequence) {
          store.dispose();
          return;
        }
        bundleRef.current = bundle;
        shownRef.current = new Map(photos.map((photo) => [photo.id, photo]));
        setStored({
          scopeKey,
          photos,
          status: archive.status === 'blocked' ? 'failed' : 'ready',
          error: archive.status === 'blocked' ? TRUST_ERROR : null,
          revision,
        });
      } catch {
        if (currentScope.current === scopeKey && readSequence.current === sequence) {
          setProtocolState({ scopeKey, status: 'unavailable' });
          setStored((previous) => ({ scopeKey, photos: previous.scopeKey === scopeKey ? previous.photos : [], status: 'failed', error: READ_ERROR, revision }));
        }
      } finally {
        if (readSequence.current === sequence && operationRef.current === scopeKey) operationRef.current = null;
      }
    })();
    return () => {
      if (currentScope.current === scopeKey) currentScope.current = null;
      const bundle = bundleRef.current;
      if (bundle && bundle.scopeKey === scopeKey) {
        bundle.store.dispose();
        bundleRef.current = null;
      }
    };
  }, [userId, spaceId, scopeKey, revision]);

  const choosePhotos = useCallback(async () => {
    const bundle = bundleRef.current;
    if (!bundle || bundle.scopeKey !== scopeKey || operationRef.current === scopeKey || stored.scopeKey !== scopeKey || stored.status !== 'ready' || stored.revision !== revision) return;
    operationRef.current = scopeKey;
    ++readSequence.current;
    setOperation({ scopeKey, kind: 'importing' });
    setActionError(null);
    let selected: SelectedSkyPhoto[] = [];
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: SKY_PHOTO_BATCH_LIMIT,
        allowsEditing: false, quality: 1, exif: false,
      });
      if (result.canceled) return;
      selected = result.assets.map((asset) => ({ uri: asset.uri }));
      if (currentScope.current !== scopeKey) return;
      if (selected.length > SKY_PHOTO_BATCH_LIMIT) {
        setActionError({ scopeKey, message: `Choose up to ${SKY_PHOTO_BATCH_LIMIT} photos at a time. None were added.` });
        return;
      }
      for (const photo of selected) {
        if (currentScope.current !== scopeKey) return;
        const prepared = await prepareSkyPhoto(photo.uri);
        if (currentScope.current !== scopeKey) return;
        if (bundle.protocol) {
          // The archive journals the upload before its first network call, so a
          // termination at any point leaves enough to resume under this id.
          await uploadProtocolPhoto(bundle.protocol, prepared, { scopeKey });
        } else if (bundle.session) {
          await sealAndUploadPhoto(bundle.session, prepared);
        } else {
          throw new Error('The shared album is not ready');
        }
      }
      const { photos } = await loadBundlePhotos(bundle, shownRef.current);
      if (currentScope.current === scopeKey) {
        shownRef.current = new Map(photos.map((photo) => [photo.id, photo]));
        setStored({ scopeKey, photos, status: 'ready', error: null, revision });
      }
    } catch {
      if (currentScope.current === scopeKey) setActionError({ scopeKey, message: ADD_ERROR });
    } finally {
      releaseSelectedSkyPhotos(selected);
      if (operationRef.current === scopeKey) operationRef.current = null;
      setOperation((current) => current?.scopeKey === scopeKey ? null : current);
    }
  }, [scopeKey, stored.scopeKey, stored.status, stored.revision, revision]);

  const removePhoto = useCallback(async (id: string) => {
    const bundle = bundleRef.current;
    if (!bundle || bundle.scopeKey !== scopeKey || operationRef.current === scopeKey) return;
    operationRef.current = scopeKey;
    setOperation({ scopeKey, kind: 'removing' });
    setActionError(null);
    try {
      const protocolRevision = bundle.protocolRevisions.get(id);
      if (bundle.protocol && protocolRevision !== undefined) {
        await removeProtocolPhoto(bundle.protocol, { mediaId: id, manifestRevision: protocolRevision });
      } else if (bundle.session) {
        await bundle.session.client.remove(id);
      } else {
        throw new Error('The shared album is not ready');
      }
      await bundle.store.removeCached(id);
      if (currentScope.current === scopeKey) setStored((previous) => ({ ...previous, photos: previous.photos.filter((photo) => photo.id !== id) }));
    } catch {
      if (currentScope.current === scopeKey) {
        setActionError({ scopeKey, message: REMOVE_ERROR });
        try {
          const { photos } = await loadBundlePhotos(bundle, shownRef.current);
          if (currentScope.current === scopeKey) {
            shownRef.current = new Map(photos.map((photo) => [photo.id, photo]));
            setStored({ scopeKey, photos, status: 'ready', error: null, revision });
          }
        } catch {
          if (currentScope.current === scopeKey) setStored((previous) => ({ ...previous, status: 'failed', error: READ_ERROR }));
        }
      }
    } finally {
      if (operationRef.current === scopeKey) operationRef.current = null;
      setOperation((current) => current?.scopeKey === scopeKey ? null : current);
    }
  }, [scopeKey, revision]);

  const sameScope = stored.scopeKey === scopeKey && scopeKey !== null;
  return {
    photos: sameScope ? stored.photos : [],
    status: sameScope && stored.revision === revision ? stored.status : 'loading',
    readError: sameScope && stored.revision === revision ? stored.error : null,
    actionError: actionError?.scopeKey === scopeKey ? actionError.message : null,
    operation: operation?.scopeKey === scopeKey ? operation.kind : null,
    protocolStatus: protocolState?.scopeKey === scopeKey ? protocolState.status : 'none',
    scopeKey,
    reload,
    choosePhotos,
    removePhoto,
  };
}
