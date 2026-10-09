import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import type { Collection } from '@aoi/shared';

import { isStubMode } from '@/features/api-client';
import { createLocalCollectionsRepository } from '@/features/collections/local-collections-repository';
import { remoteCollectionsRepository } from '@/features/collections/remote-collections-repository';
import type {
  CollectionsContextValue,
  CollectionsRepository,
  CreateCollectionItemRequest,
  CreateCollectionRequest,
  UpdateCollectionItemRequest,
  UpdateCollectionRequest,
} from '@/features/collections/types';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

const CollectionsContext = createContext<CollectionsContextValue | undefined>(undefined);

function sortCollections(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => a.position - b.position);
}

/**
 * The couple's shared shelves. Stub mode keeps them device-local per active
 * space (AsyncStorage); remote mode talks to the API so both partners see the
 * same shelves, refreshed whenever the app returns to focus.
 */
export function CollectionsProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const { space } = useSpace();
  const userId = user?.id;
  const spaceId = space?.id;
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const repository = useMemo<CollectionsRepository | null>(() => {
    if (!userId) {
      return null;
    }

    if (isStubMode()) {
      // The active space is the isolation boundary; fall back to the user id
      // only if a space is not yet hydrated.
      return createLocalCollectionsRepository(spaceId ?? userId);
    }

    return remoteCollectionsRepository;
  }, [spaceId, userId]);

  useEffect(() => {
    if (!repository) {
      setCollections([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const loaded = await repository.listCollections();

        if (!cancelled) {
          setCollections(sortCollections(loaded));
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Your lists could not be loaded right now.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repository]);

  const reload = useCallback(async () => {
    if (!repository) {
      return;
    }

    try {
      const loaded = await repository.listCollections();
      setCollections(sortCollections(loaded));
      setError(null);
    } catch {
      setError('Your shelves could not be loaded right now.');
    }
  }, [repository]);

  // Partner changes appear when the app returns to focus (remote mode only;
  // the stub shelves live on this device already).
  useEffect(() => {
    if (!repository || isStubMode()) {
      return;
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        void reload();
      }
    });

    return () => subscription.remove();
  }, [reload, repository]);

  const createCollection = useCallback(
    async (input: CreateCollectionRequest) => {
      if (!repository) {
        throw new Error('Not signed in.');
      }

      const created = await repository.createCollection(input);
      setCollections((current) => sortCollections([...current, created]));
      return created;
    },
    [repository]
  );

  const updateCollection = useCallback(
    async (id: string, input: UpdateCollectionRequest) => {
      if (!repository) {
        throw new Error('Not signed in.');
      }

      const updated = await repository.updateCollection(id, input);
      setCollections((current) =>
        sortCollections(current.map((collection) => (collection.id === id ? updated : collection)))
      );
      return updated;
    },
    [repository]
  );

  const deleteCollection = useCallback(
    async (id: string) => {
      if (!repository) {
        throw new Error('Not signed in.');
      }

      await repository.deleteCollection(id);
      setCollections((current) => current.filter((collection) => collection.id !== id));
    },
    [repository]
  );

  /**
   * Reorder by swapping a list with its neighbour, then normalising positions
   * to 0..n-1 so the stored order is always clean and only changed rows write.
   */
  const moveCollection = useCallback(
    async (id: string, direction: -1 | 1) => {
      const ordered = sortCollections(collections);
      const index = ordered.findIndex((collection) => collection.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) {
        return;
      }

      const reordered = [...ordered];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved);

      await Promise.all(
        reordered.map((collection, position) =>
          collection.position === position
            ? Promise.resolve()
            : updateCollection(collection.id, { position })
        )
      );
    },
    [collections, updateCollection]
  );

  const listItems = useCallback(
    async (collectionId: string) => {
      if (!repository) {
        return [];
      }
      return repository.listItems(collectionId);
    },
    [repository]
  );

  const createItem = useCallback(
    async (collectionId: string, input: CreateCollectionItemRequest) => {
      if (!repository) {
        throw new Error('Not signed in.');
      }

      const created = await repository.createItem(collectionId, input);
      // Keep the Ours grid count honest without a full re-read.
      setCollections((current) =>
        current.map((collection) =>
          collection.id === collectionId
            ? { ...collection, itemCount: collection.itemCount + 1 }
            : collection
        )
      );
      return created;
    },
    [repository]
  );

  const updateItem = useCallback(
    async (itemId: string, input: UpdateCollectionItemRequest) => {
      if (!repository) {
        throw new Error('Not signed in.');
      }
      return repository.updateItem(itemId, input);
    },
    [repository]
  );

  const deleteItem = useCallback(
    async (collectionId: string, itemId: string) => {
      if (!repository) {
        throw new Error('Not signed in.');
      }

      await repository.deleteItem(itemId);
      setCollections((current) =>
        current.map((collection) =>
          collection.id === collectionId
            ? { ...collection, itemCount: Math.max(0, collection.itemCount - 1) }
            : collection
        )
      );
    },
    [repository]
  );

  const value = useMemo<CollectionsContextValue>(
    () => ({
      collections,
      isLoading,
      error,
      reload,
      createCollection,
      updateCollection,
      deleteCollection,
      moveCollection,
      listItems,
      createItem,
      updateItem,
      deleteItem,
    }),
    [
      collections,
      createCollection,
      createItem,
      deleteCollection,
      deleteItem,
      error,
      isLoading,
      listItems,
      moveCollection,
      reload,
      updateCollection,
      updateItem,
    ]
  );

  return (
    <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>
  );
}

export function useCollections(): CollectionsContextValue {
  const context = useContext(CollectionsContext);

  if (!context) {
    throw new Error('useCollections must be used within CollectionsProvider');
  }

  return context;
}
