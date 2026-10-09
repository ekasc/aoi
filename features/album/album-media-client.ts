import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

import {
  albumObjectUrl,
  type AlbumMediaRecord,
  type AlbumUploadIntentRequest,
  type AlbumUploadIntentResponse,
  type SpaceBackup,
} from '@aoi/shared';

import { apiFetch, apiFetchBytes, isStubMode } from '@/features/api-client';
import { fromBase64, toArrayBuffer, toBase64 } from '@/features/album/crypto';
import type { WireDeviceIdentity } from '@/features/album/keys';

/**
 * The album's transport.
 *
 * One interface, two implementations: the real Cloudflare Worker, and a local
 * one during stub development. The rest of the album works against the
 * interface and never learns which one is underneath.
 *
 * The presigned PUT lives here rather than in the session because it is the
 * one write that bypasses the API's JSON envelope (a photo is far too large to
 * travel through it) and because the local stub has to intercept the same
 * bytes. Sealing happens above this layer; everything below moves opaque
 * ciphertext.
 */
export interface AlbumMediaClient {
  createIntent(input: AlbumUploadIntentRequest): Promise<AlbumUploadIntentResponse>;
  /** PUT the sealed bytes to the short-lived URL the intent returned. */
  putObject(intent: AlbumUploadIntentResponse, bytes: Uint8Array): Promise<void>;
  complete(id: string): Promise<void>;
  list(): Promise<AlbumMediaRecord[]>;
  /** The sealed ciphertext blob for one photo (not the image). */
  fetchObject(id: string): Promise<Uint8Array>;
  remove(id: string): Promise<void>;
  getBackup(): Promise<SpaceBackup>;
  putBackup(backup: SpaceBackup): Promise<SpaceBackup>;
}

const EMPTY_BACKUP: SpaceBackup = { identities: [], deviceKeys: [], envelopes: [] };

// ── the real worker ──────────────────────────────────────────────────────

const MEDIA_PATH = '/v1/spaces/current/album/media';
const BACKUP_PATH = '/v1/spaces/current/album/backup';

export function createRemoteAlbumMediaClient(): AlbumMediaClient {
  return {
    async createIntent(input) {
      return apiFetch<AlbumUploadIntentResponse>(MEDIA_PATH, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    async putObject(intent, bytes) {
      // A plain fetch, deliberately: the URL is presigned and points at object
      // storage, so it must not carry our Authorization header.
      const response = await fetch(intent.uploadUrl, {
        method: 'PUT',
        body: toArrayBuffer(bytes),
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(intent.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
    },

    async complete(id) {
      await apiFetch<{ ok: true }>(
        `${MEDIA_PATH}/${encodeURIComponent(id)}/complete`,
        { method: 'POST', body: JSON.stringify({}) },
      );
    },

    async list() {
      const response = await apiFetch<{ media: AlbumMediaRecord[] }>(MEDIA_PATH);
      return response.media;
    },

    async fetchObject(id) {
      const response = await apiFetchBytes(albumObjectUrl(id));
      return response.bytes;
    },

    async remove(id) {
      await apiFetch<{ ok: true }>(`${MEDIA_PATH}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },

    async getBackup() {
      // A space that has never been opened may answer null rather than an
      // empty backup. Both mean the same thing: nothing to restore yet.
      const backup = await apiFetch<SpaceBackup | null>(BACKUP_PATH);
      return backup ?? EMPTY_BACKUP;
    },

    async putBackup(backup) {
      return apiFetch<SpaceBackup>(BACKUP_PATH, {
        method: 'PUT',
        body: JSON.stringify(backup),
      });
    },
  };
}

// ── the local stub ───────────────────────────────────────────────────────

const LOCAL_PREFIX = 'aoi.album.client.v1.';

/**
 * A fabricated partner so stub/dev mode has somebody to agree a space key
 * with. The keys are fixed constants, not random, because the derived space
 * key has to survive a reload: a new partner key every boot would make every
 * photo uploaded before the reload undecryptable. There is no real second
 * device in a preview, so there is nothing to hide and nothing to rotate.
 */
const STUB_PARTNER: WireDeviceIdentity = {
  deviceId: 'stub-partner-device',
  signingPublicKey: 'Zr5+Myx6RTMyvZ0Kf32wVfXF7xoGraZtmLOftoEMRzo=',
  agreementPublicKey: 'E75P6uryBMf9M1j8nAByGIHRdCeBKCJ+xnTzf3/pe20=',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function stubSeedBackup(): SpaceBackup {
  return { identities: [STUB_PARTNER], deviceKeys: [], envelopes: [] };
}

type PendingIntent = AlbumUploadIntentRequest;

export function createLocalAlbumMediaClient(spaceId: string): AlbumMediaClient {
  const recordsKey = `${LOCAL_PREFIX}${spaceId}.records`;
  const backupKey = `${LOCAL_PREFIX}${spaceId}.backup`;
  const objectKey = (id: string) => `${LOCAL_PREFIX}${spaceId}.object.${id}`;
  const pendingKey = (id: string) => `${LOCAL_PREFIX}${spaceId}.pending.${id}`;

  const readRecords = async (): Promise<AlbumMediaRecord[]> => {
    const raw = await AsyncStorage.getItem(recordsKey);
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AlbumMediaRecord[]) : [];
    } catch {
      return [];
    }
  };

  const writeRecords = (records: AlbumMediaRecord[]) =>
    AsyncStorage.setItem(recordsKey, JSON.stringify(records));

  return {
    async createIntent(input) {
      const mediaId = `m-${randomUUID()}`;
      await AsyncStorage.setItem(pendingKey(mediaId), JSON.stringify(input));
      return {
        mediaId,
        uploadUrl: `stub://album/${encodeURIComponent(spaceId)}/${mediaId}`,
        expiresInSec: 3600,
      };
    },

    async putObject(intent, bytes) {
      await AsyncStorage.setItem(objectKey(intent.mediaId), toBase64(bytes));
    },

    async complete(id) {
      const raw = await AsyncStorage.getItem(pendingKey(id));
      if (!raw) {
        return;
      }
      const input = JSON.parse(raw) as PendingIntent;
      const record: AlbumMediaRecord = {
        id,
        wrappedKey: input.wrappedKey,
        sealedNonce: input.sealedNonce,
        createdAt: new Date().toISOString(),
        byteLength: input.byteLength,
        mimeType: input.mimeType,
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.personTag !== undefined ? { personTag: input.personTag } : {}),
      };
      const records = await readRecords();
      await writeRecords([...records, record]);
      await AsyncStorage.removeItem(pendingKey(id));
    },

    list: readRecords,

    async fetchObject(id) {
      const stored = await AsyncStorage.getItem(objectKey(id));
      return stored ? fromBase64(stored) : new Uint8Array();
    },

    async remove(id) {
      const records = await readRecords();
      await writeRecords(records.filter((record) => record.id !== id));
      await AsyncStorage.removeItem(objectKey(id));
      await AsyncStorage.removeItem(pendingKey(id));
    },

    async getBackup() {
      const raw = await AsyncStorage.getItem(backupKey);
      if (!raw) {
        return stubSeedBackup();
      }
      try {
        return JSON.parse(raw) as SpaceBackup;
      } catch {
        return stubSeedBackup();
      }
    },

    async putBackup(backup) {
      await AsyncStorage.setItem(backupKey, JSON.stringify(backup));
      return backup;
    },
  };
}

export function getAlbumMediaClient(spaceId: string): AlbumMediaClient {
  return isStubMode()
    ? createLocalAlbumMediaClient(spaceId)
    : createRemoteAlbumMediaClient();
}
