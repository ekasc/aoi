/**
 * Collections — the shared shelves a couple names and fills.
 *
 * The contract is frozen in `packages/shared/src/collection.ts`; this module
 * re-exports it so the feature has one import surface, and adds the client
 * repository + context shapes (mirroring `features/someday`).
 */
export {
  COLLECTION_NAME_MAX,
  COLLECTION_EMOJI_MAX,
  COLLECTION_ITEM_TITLE_MAX,
  COLLECTION_ITEM_NOTE_MAX,
  COLLECTION_LINK_MAX,
  COLLECTION_COVER_MAX,
  COLLECTION_COLORS,
  COLLECTION_STATUSES,
  COLLECTION_SCORE_MIN,
  COLLECTION_SCORE_MAX,
  type Collection,
  type CollectionColor,
  type CollectionStatus,
  type CollectionItem,
  type CreateCollectionRequest,
  type UpdateCollectionRequest,
  type CreateCollectionItemRequest,
  type UpdateCollectionItemRequest,
} from '@aoi/shared';

import type {
  Collection,
  CollectionItem,
  CreateCollectionItemRequest,
  CreateCollectionRequest,
  UpdateCollectionItemRequest,
  UpdateCollectionRequest,
} from '@aoi/shared';

export type CollectionsRepository = {
  /** Shelves for the active space, in position order. */
  listCollections: () => Promise<Collection[]>;
  createCollection: (input: CreateCollectionRequest) => Promise<Collection>;
  updateCollection: (id: string, input: UpdateCollectionRequest) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;

  /** Items in a shelf, in position order. */
  listItems: (collectionId: string) => Promise<CollectionItem[]>;
  createItem: (
    collectionId: string,
    input: CreateCollectionItemRequest
  ) => Promise<CollectionItem>;
  updateItem: (itemId: string, input: UpdateCollectionItemRequest) => Promise<CollectionItem>;
  deleteItem: (itemId: string) => Promise<void>;
};

export type CollectionsContextValue = {
  collections: Collection[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  createCollection: (input: CreateCollectionRequest) => Promise<Collection>;
  updateCollection: (id: string, input: UpdateCollectionRequest) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;
  /** Move a list one place up (-1) or down (1) in the couple's order. */
  moveCollection: (id: string, direction: -1 | 1) => Promise<void>;

  listItems: (collectionId: string) => Promise<CollectionItem[]>;
  createItem: (
    collectionId: string,
    input: CreateCollectionItemRequest
  ) => Promise<CollectionItem>;
  updateItem: (itemId: string, input: UpdateCollectionItemRequest) => Promise<CollectionItem>;
  deleteItem: (collectionId: string, itemId: string) => Promise<void>;
};
