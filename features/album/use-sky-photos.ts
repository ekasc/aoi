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
  establishProtocolArchive,
  readProtocolArchive,
  removeProtocolPhoto,
  uploadProtocolPhoto,
  type ProtocolArchiveReady,
} from '@/features/album/protocol-archive';
import { prepareSkyPhoto } from '@/features/album/sky-photo-import';
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
 *             own path and left exactly as it is. An upgrade is a migration,
 *             and this hook does not perform one.
 *
 * The plaintext cache is an optimisation in both cases. Only media that passed
 * its checks is handed to it, and a read that *failed* never evicts: a network
 * blip must not look like an authenticated empty archive.
 */

type PhotoRead = {
  scopeKey: string | null;
  photos: SkyPhoto[];
  status: 'loading' | 'ready' | 'failed';
  error: string | null;
  revision: number;
};

type SessionBundle = {
  scopeKey: string;
  session: AlbumSessionReady;
  protocol: ProtocolArchiveReady | null;
  /** Signed media this device currently shows, with its manifest revision. */
  protocolRevisions: Map<string, number>;
  /** The plaintext of those photos, so one cache serves both formats. */
  protocolBytes: Map<string, Uint8Array>;
  store: AlbumPhotoStore;
};

const READ_ERROR = 'Could not open your shared photos. Please try again.';
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

/**
 * Everything this device may show, in one pass. Signed media is verified first,
 * so the cache only ever receives media that passed its checks.
 */
async function loadBundlePhotos(bundle: SessionBundle): Promise<SkyPhoto[]> {
  const records = await bundle.session.client.list();
  if (!bundle.protocol) {
    return bundle.store.list(records);
  }

  const read = await readProtocolArchive(bundle.protocol);
  bundle.protocolRevisions.clear();
  bundle.protocolBytes.clear();
  for (const photo of read.photos) {
    bundle.protocolBytes.set(photo.mediaId, photo.bytes);
    bundle.protocolRevisions.set(photo.mediaId, 1);
  }
  return bundle.store.list([...read.photos.map(protocolRecord), ...records]);
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
  const [revision, setRevision] = useState(0);
  const [stored, setStored] = useState<PhotoRead>({ scopeKey: null, photos: [], status: 'loading', error: null, revision: 0 });
  const [operation, setOperation] = useState<{ scopeKey: string | null; kind: 'importing' | 'removing' } | null>(null);
  const [actionError, setActionError] = useState<{ scopeKey: string | null; message: string } | null>(null);

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
      return;
    }
    operationRef.current = scopeKey;
    void (async () => {
      try {
        const session = await establishAlbumSession({ userId, spaceId });
        if (currentScope.current !== scopeKey || readSequence.current !== sequence) return;
        if (session.status === 'waiting') {
          setStored({ scopeKey, photos: [], status: 'ready', error: null, revision });
          return;
        }

        // Signed media, if this device has joined the signed protocol at all.
        // `waiting` and `unavailable` both mean "read the legacy archive", not
        // an error: the Space may simply not have been upgraded yet.
        const archive = await establishProtocolArchive({ spaceId });
        const protocol = archive.status === 'ready' ? archive : null;

        const protocolBytes = new Map<string, Uint8Array>();
        const protocolRevisions = new Map<string, number>();
        const store = createAlbumPhotoStore({
          spaceId,
          fetchObject: async (id) => protocolBytes.get(id) ?? session.client.fetchObject(id),
          open: (record, bytes) =>
            protocolBytes.has(record.id) ? bytes : openPhoto(session.spaceKey, record, bytes),
        });
        const bundle: SessionBundle = {
          scopeKey,
          session,
          protocol,
          protocolRevisions,
          protocolBytes,
          store,
        };

        const photos = await loadBundlePhotos(bundle);

        // Authenticated deletion evicts the cached plaintext. This runs only
        // after a read that succeeded, so a failed fetch never deletes.
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
        setStored({ scopeKey, photos, status: 'ready', error: null, revision });
      } catch {
        if (currentScope.current === scopeKey && readSequence.current === sequence) {
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
          await uploadProtocolPhoto(bundle.protocol, prepared);
        } else {
          await sealAndUploadPhoto(bundle.session, prepared);
        }
      }
      const photos = await loadBundlePhotos(bundle);
      if (currentScope.current === scopeKey) setStored({ scopeKey, photos, status: 'ready', error: null, revision });
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
      } else {
        await bundle.session.client.remove(id);
      }
      await bundle.store.removeCached(id);
      if (currentScope.current === scopeKey) setStored((previous) => ({ ...previous, photos: previous.photos.filter((photo) => photo.id !== id) }));
    } catch {
      if (currentScope.current === scopeKey) {
        setActionError({ scopeKey, message: REMOVE_ERROR });
        try {
          const photos = await loadBundlePhotos(bundle);
          if (currentScope.current === scopeKey) setStored({ scopeKey, photos, status: 'ready', error: null, revision });
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
    scopeKey,
    reload,
    choosePhotos,
    removePhoto,
  };
}
