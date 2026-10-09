import type { SealedMedia } from '@/features/album/crypto';
import type { SignedDeviceKey, WireDeviceIdentity } from '@/features/album/keys';

/**
 * What the server holds, and what it therefore knows.
 *
 * Split deliberately. The ciphertext and the wrapped keys are opaque: the
 * server can store them, hand them back to a new phone, and read nothing,
 * because the thing that unwraps them is a key the server has never seen.
 *
 * The metadata is not opaque, and pretending otherwise would be the actual
 * privacy failure. The server learns that a photo exists, when, how large it
 * is, and who has one. That is a real cost of this design and it belongs in
 * the type where somebody reading it later cannot miss it.
 */

export type AlbumMedia = {
  id: string;
  /** The photo, encrypted under its own media key. */
  sealed: SealedMedia;
  /** That media key, wrapped under the space key. Opaque to the server. */
  wrappedKey: SealedMedia;
  // ── below here the server can read it ────────────────────────────────────
  createdAt: string;
  byteLength: number;
  mimeType: string;
  width?: number;
  height?: number;
  /** Set once a face has been matched to one of the two of you. */
  personTag?: 'you' | 'partner';
};

/**
 * How a device gets hold of the space key on a phone that has never seen it.
 *
 * The space key is wrapped under an ECDH between the *new* device's
 * agreement key and the *authorising* device's, and the whole envelope is
 * signed by the authoriser's identity. So:
 *
 *   - the server can store and return it, and cannot open it
 *   - a device nobody authorised gets no envelope at all
 *   - an envelope from somebody other than your partner is refused
 *
 * Authorising needs the partner once. Restoring does not: a new phone reads
 * its envelope from the server and is in, with nobody online. That is the
 * whole reason this is not a rekey ceremony.
 */
export type SpaceKeyEnvelope = {
  /** The device this envelope is for. */
  deviceId: string;
  /** Space key, wrapped under ECDH(newDevice.agreement, authoriser.agreement). */
  sealed: SealedMedia;
  /** The identity that authorised it, and its signature over the rest. */
  authorisedBy: string;
  signature: string;
  createdAt: string;
};

export type SpaceBackup = {
  /** Everyone's identity, so a new device knows who to expect. */
  identities: WireDeviceIdentity[];
  /** Device keys each identity has vouched for. */
  deviceKeys: SignedDeviceKey[];
  /** One envelope per authorised device. */
  envelopes: SpaceKeyEnvelope[];
};

export type AlbumRepository = {
  listMedia: () => Promise<AlbumMedia[]>;
  putMedia: (media: AlbumMedia) => Promise<void>;
  deleteMedia: (mediaId: string) => Promise<void>;
  getBackup: () => Promise<SpaceBackup | null>;
  putBackup: (backup: SpaceBackup) => Promise<void>;
};
