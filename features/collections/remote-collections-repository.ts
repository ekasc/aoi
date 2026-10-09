import type { Collection, CollectionItem } from '@aoi/shared';

import { apiFetch } from '@/features/api-client';
import type { CollectionsRepository } from '@/features/collections/types';

/** Manual order is the server's `position`; appending puts a new row last. */
function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position;
}

type CollectionListResponse = { collections: Collection[] };
type CollectionItemListResponse = { items: CollectionItem[] };
type CollectionResponse = { collection: Collection };
type CollectionItemResponse = { item: CollectionItem };

export const remoteCollectionsRepository: CollectionsRepository = {
  async listCollections() {
    const response = await apiFetch<CollectionListResponse>(
      '/v1/spaces/current/collections'
    );
    // The server already returns position order; sorting again keeps parity
    // with the local repository no matter what.
    return [...response.collections].sort(byPosition);
  },

  async createCollection(input) {
    const response = await apiFetch<CollectionResponse>(
      '/v1/spaces/current/collections',
      { method: 'POST', body: JSON.stringify(input) }
    );
    return response.collection;
  },

  async updateCollection(id, input) {
    const response = await apiFetch<CollectionResponse>(`/v1/collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return response.collection;
  },

  async deleteCollection(id) {
    await apiFetch<{ ok: boolean }>(`/v1/collections/${id}`, { method: 'DELETE' });
  },

  async listItems(collectionId) {
    const response = await apiFetch<CollectionItemListResponse>(
      `/v1/collections/${collectionId}/items`
    );
    return [...response.items].sort(byPosition);
  },

  async createItem(collectionId, input) {
    const response = await apiFetch<CollectionItemResponse>(
      `/v1/collections/${collectionId}/items`,
      { method: 'POST', body: JSON.stringify(input) }
    );
    return response.item;
  },

  async updateItem(itemId, input) {
    const response = await apiFetch<CollectionItemResponse>(
      `/v1/collection-items/${itemId}`,
      { method: 'PATCH', body: JSON.stringify(input) }
    );
    return response.item;
  },

  async deleteItem(itemId) {
    await apiFetch<{ ok: boolean }>(`/v1/collection-items/${itemId}`, {
      method: 'DELETE',
    });
  },
};
