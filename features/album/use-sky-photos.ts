import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createAlbumPhotoStore, type AlbumPhotoStore } from '@/features/album/album-photo-store';
import {
  establishAlbumSession,
  openPhoto,
  sealAndUploadPhoto,
  type AlbumSessionReady,
} from '@/features/album/album-session';
import { prepareSkyPhoto } from '@/features/album/sky-photo-import';
import { SKY_PHOTO_BATCH_LIMIT, releaseSelectedSkyPhotos, skyPhotoScopeKey, type SelectedSkyPhoto, type SkyPhoto } from '@/features/album/sky-photo-repository';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

/**
 * The Us sky, now backed by the shared, encrypted album.
 *
 * The public shape is unchanged from the local-only version so the screen
 * above it did not have to move. What changed is underneath: a scope change
 * establishes a session, lists sealed records, and decrypts them into
 * displayable copies. A partner who has not joined yet is a `waiting` session,
 * which surfaces as an empty but ready sky rather than an error.
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
  store: AlbumPhotoStore;
};

const READ_ERROR = 'Could not open your shared photos. Please try again.';
const ADD_ERROR = 'Could not add these photos. Please try again.';
const REMOVE_ERROR = 'Could not finish removing this photo. Please try again.';

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
        const store = createAlbumPhotoStore({
          spaceId,
          fetchObject: session.client.fetchObject,
          open: (record, bytes) => openPhoto(session.spaceKey, record, bytes),
        });
        const records = await session.client.list();
        const photos = await store.list(records);
        if (currentScope.current !== scopeKey || readSequence.current !== sequence) {
          store.dispose();
          return;
        }
        bundleRef.current = { scopeKey, session, store };
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
        await sealAndUploadPhoto(bundle.session, prepared);
      }
      const records = await bundle.session.client.list();
      const photos = await bundle.store.list(records);
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
      await bundle.session.client.remove(id);
      await bundle.store.removeCached(id);
      if (currentScope.current === scopeKey) setStored((previous) => ({ ...previous, photos: previous.photos.filter((photo) => photo.id !== id) }));
    } catch {
      if (currentScope.current === scopeKey) {
        setActionError({ scopeKey, message: REMOVE_ERROR });
        try {
          const records = await bundle.session.client.list();
          const photos = await bundle.store.list(records);
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
