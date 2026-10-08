import {
  wireAlbumDeviceRecordResponseSchema,
  wireAlbumMediaManifestResponseSchema,
  wireAlbumMediaProtocolSchema,
  wireAlbumMediaReservationResponseSchema,
  wireAlbumMediaTombstoneResponseSchema,
  wireAlbumProtocolSnapshotSchema,
  wireAlbumRecoveryEnvelopeResponseSchema,
  wireAlbumSpaceKeyEnvelopeResponseSchema,
  wireAlbumTrustAnchorResponseSchema,
  wireDeviceClaimResponseSchema,
  type WireAlbumMediaProtocol,
  type WireAlbumMediaReservationResponse,
  type WireAlbumProtocolSnapshot,
  type WireDeviceRecord,
  type WireMediaManifest,
  type WireMediaTombstone,
  type WireRecoveryEnvelope,
  type WireSpaceKeyEnvelope,
  type WireSpaceTrustAnchor,
} from '@aoi/shared';

import { apiFetch, apiFetchBytes, isStubMode } from '@/features/api-client';
import { toArrayBuffer } from '@/features/album/crypto';

/**
 * The protocol's transport.
 *
 * Every response is parsed through the same wire schema the server validates
 * with, so a client never reasons about a shape the contract does not promise.
 * The one non-JSON hop is the presigned PUT, which points at object storage and
 * must not carry our Authorization header.
 */

const PROTOCOL = '/v1/spaces/current/album/protocol';
const MEDIA = `${PROTOCOL}/media`;

/** A failed protocol request, with the status preserved for callers that act on it. */
export class ProtocolRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ProtocolRequestError';
  }
}

export type DeviceClaimRequest = {
  deviceId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
};

export type MediaReservationRequest = {
  mediaId: string;
  generation: number;
  uploaderDeviceId: string;
  byteLength: number;
};

export interface AlbumProtocolClient {
  getSnapshot(): Promise<WireAlbumProtocolSnapshot>;
  putAnchor(anchor: WireSpaceTrustAnchor): Promise<void>;
  claimDevice(claim: DeviceClaimRequest): Promise<void>;
  putDeviceRecord(record: WireDeviceRecord): Promise<void>;
  putSpaceKeyEnvelope(envelope: WireSpaceKeyEnvelope): Promise<void>;
  putRecoveryEnvelope(generation: number, envelope: WireRecoveryEnvelope): Promise<void>;
  reserveMedia(input: MediaReservationRequest): Promise<WireAlbumMediaReservationResponse>;
  putObject(
    uploadUrl: string,
    headers: Record<string, string> | undefined,
    bytes: Uint8Array
  ): Promise<void>;
  finalizeMedia(mediaId: string): Promise<void>;
  putManifest(mediaId: string, manifest: WireMediaManifest): Promise<void>;
  postMediaTombstone(tombstone: WireMediaTombstone): Promise<void>;
  fetchMediaProtocol(cursor: string | null): Promise<WireAlbumMediaProtocol>;
  fetchMediaObject(mediaId: string): Promise<Uint8Array>;
}

function remoteClient(): AlbumProtocolClient {
  return {
    async getSnapshot() {
      return wireAlbumProtocolSnapshotSchema.parse(await apiFetch<unknown>(PROTOCOL));
    },
    async putAnchor(anchor) {
      wireAlbumTrustAnchorResponseSchema.parse(
        await apiFetch<unknown>(`${PROTOCOL}/anchor`, {
          method: 'PUT',
          body: JSON.stringify(anchor),
        })
      );
    },
    async claimDevice(claim) {
      wireDeviceClaimResponseSchema.parse(
        await apiFetch<unknown>(`${PROTOCOL}/device-claims`, {
          method: 'POST',
          body: JSON.stringify(claim),
        })
      );
    },
    async putDeviceRecord(record) {
      wireAlbumDeviceRecordResponseSchema.parse(
        await apiFetch<unknown>(`${PROTOCOL}/devices/${encodeURIComponent(record.deviceId)}`, {
          method: 'PUT',
          body: JSON.stringify(record),
        })
      );
    },
    async putSpaceKeyEnvelope(envelope) {
      wireAlbumSpaceKeyEnvelopeResponseSchema.parse(
        await apiFetch<unknown>(`${PROTOCOL}/envelopes`, {
          method: 'PUT',
          body: JSON.stringify(envelope),
        })
      );
    },
    async putRecoveryEnvelope(generation, envelope) {
      wireAlbumRecoveryEnvelopeResponseSchema.parse(
        await apiFetch<unknown>(`${PROTOCOL}/recovery-envelopes/${generation}`, {
          method: 'PUT',
          body: JSON.stringify(envelope),
        })
      );
    },
    async reserveMedia(input) {
      return wireAlbumMediaReservationResponseSchema.parse(
        await apiFetch<unknown>(MEDIA, { method: 'POST', body: JSON.stringify(input) })
      );
    },
    async putObject(uploadUrl, headers, bytes) {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: toArrayBuffer(bytes),
        headers: { 'Content-Type': 'application/octet-stream', ...(headers ?? {}) },
      });
      // 412 is the conditional create refusing a key that already holds an
      // object. On a retry that is exactly what we wanted to happen.
      if (!response.ok && response.status !== 412) {
        throw new ProtocolRequestError(response.status, `Upload failed: ${response.status}`);
      }
    },
    async finalizeMedia(mediaId) {
      await apiFetch<unknown>(`${MEDIA}/${encodeURIComponent(mediaId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    async putManifest(mediaId, manifest) {
      wireAlbumMediaManifestResponseSchema.parse(
        await apiFetch<unknown>(`${MEDIA}/${encodeURIComponent(mediaId)}/manifest`, {
          method: 'PUT',
          body: JSON.stringify(manifest),
        })
      );
    },
    async postMediaTombstone(tombstone) {
      wireAlbumMediaTombstoneResponseSchema.parse(
        await apiFetch<unknown>(`${PROTOCOL}/media-tombstones`, {
          method: 'POST',
          body: JSON.stringify(tombstone),
        })
      );
    },
    async fetchMediaProtocol(cursor) {
      const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      return wireAlbumMediaProtocolSchema.parse(await apiFetch<unknown>(`${MEDIA}${query}`));
    },
    async fetchMediaObject(mediaId) {
      const result = await apiFetchBytes(`${MEDIA}/${encodeURIComponent(mediaId)}/object`);
      return result.bytes;
    },
  };
}

/**
 * The protocol has no stub backend: the dev world is a single device with no
 * second witness, so there is nothing truthful to enrol against. Returning a
 * client that fails loudly keeps the archive on its legacy path there instead
 * of inventing a fake trust root.
 */
function unavailableClient(): AlbumProtocolClient {
  const refuse = (): never => {
    throw new ProtocolRequestError(0, 'The signed protocol is unavailable in stub mode');
  };
  return {
    getSnapshot: async () => refuse(),
    putAnchor: async () => refuse(),
    claimDevice: async () => refuse(),
    putDeviceRecord: async () => refuse(),
    putSpaceKeyEnvelope: async () => refuse(),
    putRecoveryEnvelope: async () => refuse(),
    reserveMedia: async () => refuse(),
    putObject: async () => refuse(),
    finalizeMedia: async () => refuse(),
    putManifest: async () => refuse(),
    postMediaTombstone: async () => refuse(),
    fetchMediaProtocol: async () => refuse(),
    fetchMediaObject: async () => refuse(),
  };
}

export function getAlbumProtocolClient(): AlbumProtocolClient {
  return isStubMode() ? unavailableClient() : remoteClient();
}
