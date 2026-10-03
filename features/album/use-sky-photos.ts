import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { SKY_PHOTO_BATCH_LIMIT, releaseSelectedSkyPhotos, skyPhotoScopeKey, type SelectedSkyPhoto, type SkyPhoto } from '@/features/album/sky-photo-repository';
import { getSkyPhotoRepository } from '@/features/album/sky-photo-store';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

type PhotoRead = {
  scopeKey: string | null;
  photos: SkyPhoto[];
  status: 'loading' | 'ready' | 'failed';
  error: string | null;
  revision: number;
};

export function useSkyPhotos() {
  const { user } = useSession();
  const { space } = useSpace();
  const userId = user?.id;
  const spaceId = space?.id;
  const repository = useMemo(() => userId && spaceId ? getSkyPhotoRepository({ userId, spaceId }) : null, [userId, spaceId]);
  const scopeKey = userId && spaceId ? skyPhotoScopeKey({ userId, spaceId }) : null;
  const currentScope = useRef(scopeKey);
  useLayoutEffect(() => { currentScope.current = scopeKey; }, [scopeKey]);
  const operationRef = useRef<string | null>(null);
  const readSequence = useRef(0);
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
    if (repository) {
      operationRef.current = scopeKey;
      void repository.list().then((photos) => {
        if (currentScope.current === scopeKey && readSequence.current === sequence) setStored({ scopeKey, photos, status: 'ready', error: null, revision });
      }).catch(() => {
        if (currentScope.current === scopeKey && readSequence.current === sequence) setStored((previous) => ({ scopeKey, photos: previous.scopeKey === scopeKey ? previous.photos : [], status: 'failed', error: 'Could not open your local photos. Please try again.', revision }));
      }).finally(() => {
        if (readSequence.current === sequence && operationRef.current === scopeKey) operationRef.current = null;
      });
    }
    return () => {
      if (currentScope.current === scopeKey) currentScope.current = null;
    };
  }, [repository, scopeKey, revision]);

  useEffect(() => () => repository?.dispose(), [repository]);

  const choosePhotos = useCallback(async () => {
    if (!repository || operationRef.current === scopeKey || stored.scopeKey !== scopeKey || stored.status !== 'ready' || stored.revision !== revision) return;
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
      const photos = await repository.importPhotos(selected);
      if (currentScope.current === scopeKey) setStored({ scopeKey, photos, status: 'ready', error: null, revision });
    } catch {
      if (currentScope.current === scopeKey) setActionError({ scopeKey, message: 'Could not add these photos. Please try again.' });
    } finally {
      releaseSelectedSkyPhotos(selected);
      if (operationRef.current === scopeKey) operationRef.current = null;
      setOperation((current) => current?.scopeKey === scopeKey ? null : current);
      if (currentScope.current !== scopeKey) repository.dispose();
    }
  }, [repository, scopeKey, stored.scopeKey, stored.status, stored.revision, revision]);

  const removePhoto = useCallback(async (id: string) => {
    if (!repository || operationRef.current === scopeKey) return;
    operationRef.current = scopeKey;
    ++readSequence.current;
    setOperation({ scopeKey, kind: 'removing' });
    setActionError(null);
    try {
      await repository.remove(id);
      if (currentScope.current === scopeKey) setStored((previous) => ({ ...previous, photos: previous.photos.filter((photo) => photo.id !== id) }));
    } catch {
      if (currentScope.current === scopeKey) {
        setActionError({ scopeKey, message: 'Could not finish removing this photo. Please try again.' });
        try {
          const photos = await repository.list();
          if (currentScope.current === scopeKey) setStored({ scopeKey, photos, status: 'ready', error: null, revision });
        } catch {
          if (currentScope.current === scopeKey) setStored((previous) => ({ ...previous, status: 'failed', error: 'Could not open your local photos. Please try again.' }));
        }
      }
    } finally {
      if (operationRef.current === scopeKey) operationRef.current = null;
      setOperation((current) => current?.scopeKey === scopeKey ? null : current);
      if (currentScope.current !== scopeKey) repository.dispose();
    }
  }, [repository, scopeKey, revision]);

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
