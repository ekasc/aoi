import { z } from 'zod';

/**
 * Shared album contract — the encrypted, per-space photo library.
 *
 * The server is a dumb, membership-gated pipe. It holds:
 *   - sealed ciphertext it cannot read (opaque bytes in object storage)
 *   - a wrapped per-photo key it cannot unwrap
 *   - public keys and signed envelopes for device authorisation
 *   - non-secret metadata: when, how big, which MIME type, and which of the
 *     two of you a photo is tagged to
 *
 * That metadata is a real, disclosed cost of cloud storage and belongs in the
 * type where nobody can miss it. The bytes and keys do not.
 */

// ── sealed bytes ─────────────────────────────────────────────────────────

/**
 * Bounds on the wire shape.
 *
 * Every field here is client-controlled and is persisted close to verbatim
 * (the backup row, the wrapped-key column), so an unbounded string or array
 * is an unbounded row. The numbers are generous against real use — a handful
 * of devices, and base64 of 32–64 byte keys — and only bite a payload that is
 * trying to be large.
 */
export const BACKUP_MAX_ENTRIES = 256;
export const DEVICE_ID_MAX = 128;
export const PUBLIC_KEY_MAX = 128;
export const SIGNATURE_MAX = 256;
export const TIMESTAMP_MAX = 64;
export const SEALED_NONCE_MAX = 64;
export const SEALED_CIPHERTEXT_MAX = 4096;

/**
 * Base64 nonce + base64 ciphertext (GCM tag appended). The nonce is not
 * secret; it travels with the ciphertext so the holder of the key can open it.
 */
export const sealedMediaSchema = z.object({
  nonce: z.string().min(1).max(SEALED_NONCE_MAX),
  ciphertext: z.string().min(1).max(SEALED_CIPHERTEXT_MAX),
});

export type SealedMedia = z.infer<typeof sealedMediaSchema>;

// ── device identities & authorisation ────────────────────────────────────

/** A device's public keys. Signing is Ed25519; agreement is X25519. */
export const wireDeviceIdentitySchema = z.object({
  deviceId: z.string().min(1).max(DEVICE_ID_MAX),
  signingPublicKey: z.string().min(1).max(PUBLIC_KEY_MAX),
  agreementPublicKey: z.string().min(1).max(PUBLIC_KEY_MAX),
  createdAt: z.string().min(1).max(TIMESTAMP_MAX),
});

export type WireDeviceIdentity = z.infer<typeof wireDeviceIdentitySchema>;

/** A device key vouched for by a person's signing identity. */
export const signedDeviceKeySchema = z.object({
  deviceId: z.string().min(1).max(DEVICE_ID_MAX),
  agreementPublicKey: z.string().min(1).max(PUBLIC_KEY_MAX),
  signature: z.string().min(1).max(SIGNATURE_MAX),
  signedBy: z.string().min(1).max(PUBLIC_KEY_MAX),
});

export type SignedDeviceKey = z.infer<typeof signedDeviceKeySchema>;

/** The space key wrapped for one authorised device. */
export const spaceKeyEnvelopeSchema = z.object({
  deviceId: z.string().min(1).max(DEVICE_ID_MAX),
  sealed: sealedMediaSchema,
  authorisedBy: z.string().min(1).max(PUBLIC_KEY_MAX),
  signature: z.string().min(1).max(SIGNATURE_MAX),
  createdAt: z.string().min(1).max(TIMESTAMP_MAX),
});

export type SpaceKeyEnvelope = z.infer<typeof spaceKeyEnvelopeSchema>;

/**
 * Everything a device needs to join a space without a live partner: who to
 * expect, which device keys are vouched for, and one envelope per device.
 */
export const spaceBackupSchema = z.object({
  identities: z.array(wireDeviceIdentitySchema).max(BACKUP_MAX_ENTRIES),
  deviceKeys: z.array(signedDeviceKeySchema).max(BACKUP_MAX_ENTRIES),
  envelopes: z.array(spaceKeyEnvelopeSchema).max(BACKUP_MAX_ENTRIES),
});

export type SpaceBackup = z.infer<typeof spaceBackupSchema>;

// ── album media ──────────────────────────────────────────────────────────

export const ALBUM_PERSON_TAGS = ['you', 'partner'] as const;
export const albumPersonTagSchema = z.enum(ALBUM_PERSON_TAGS);
export type AlbumPersonTag = z.infer<typeof albumPersonTagSchema>;

/**
 * One photo's non-secret row. The list never carries the ciphertext (a
 * library of photos would be enormous); the client fetches the sealed bytes
 * from the object route and rebuilds the sealed payload.
 */
export const albumMediaRecordSchema = z.object({
  id: z.string().min(1),
  /** The media key, wrapped under the space key. Opaque to the server. */
  wrappedKey: sealedMediaSchema,
  /** Nonce of the sealed ciphertext blob (the ciphertext itself is in R2). */
  sealedNonce: z.string().min(1),
  createdAt: z.string().min(1),
  byteLength: z.number().int().positive(),
  mimeType: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  personTag: albumPersonTagSchema.optional(),
  /** Who added it, so either partner can be shown as the source. */
  createdByUserId: z.string().optional(),
});

export type AlbumMediaRecord = z.infer<typeof albumMediaRecordSchema>;

/** POST /v1/spaces/current/album/media — intent to upload one sealed photo. */
export const albumUploadIntentRequestSchema = z.object({
  mimeType: z.string().min(1).max(255),
  byteLength: z.number().int().positive().max(100 * 1024 * 1024),
  sealedNonce: z.string().min(1).max(SEALED_NONCE_MAX),
  wrappedKey: sealedMediaSchema,
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  personTag: albumPersonTagSchema.optional(),
});

export type AlbumUploadIntentRequest = z.infer<
  typeof albumUploadIntentRequestSchema
>;

export const albumUploadIntentResponseSchema = z.object({
  mediaId: z.string().min(1),
  /** Short-lived presigned PUT; never persisted by the client. */
  uploadUrl: z.string(),
  expiresInSec: z.number(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type AlbumUploadIntentResponse = z.infer<
  typeof albumUploadIntentResponseSchema
>;

export const albumMediaListResponseSchema = z.object({
  media: z.array(albumMediaRecordSchema),
});

export type AlbumMediaListResponse = z.infer<
  typeof albumMediaListResponseSchema
>;

/** Stable app URL for a photo's sealed bytes (ciphertext, not the image). */
export function albumObjectUrl(mediaId: string): string {
  return `/v1/spaces/current/album/media/${encodeURIComponent(mediaId)}/object`;
}
