import type { MomentAttachment, MomentAttachmentInput } from '@aoi/shared';
import type { Moment } from '@/features/moments/types';

export type { MomentAttachment, MomentAttachmentInput };

export type ComposerScope = {
  viewerId: string;
  spaceId: string;
};

export type StagedAssetKind = 'image' | 'audio';

export type PickerAssetDescriptor = {
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type StagedAsset = {
  stagedId: string;
  kind: StagedAssetKind;
  mimeType: string;
  /** App-private Documents copy (never a cache URI, never persisted plaintext). */
  localUri: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /**
   * Internal upload checkpoint, persisted encrypted with the manifest.
   * Lets retry/edit preserve successful uploads instead of re-uploading.
   * Never shown in UI; dropped only on explicit edit (documented) — no,
   * preserved across edit (see editPending) so retries reuse it.
   */
  uploaded?: { mediaId: string; url: string } | null;
};

export type ComposerDraft = {
  clientId: string;
  body: string;
  occurredAt: string;
  assets: StagedAsset[];
  updatedAt: string;
};

export type PendingStatus = 'queued' | 'sending' | 'failed' | 'delivered';

export type PendingSlot = {
  stagedId: string;
  kind: StagedAssetKind;
  mimeType: string;
  localUri: string;
  uploaded: { mediaId: string; url: string } | null;
};

export type PendingRecord = {
  clientId: string;
  body: string;
  occurredAt: string;
  slots: PendingSlot[];
  status: PendingStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Scope captured at Save; re-validated before every network step. */
  scope: ComposerScope;
  /**
   * Server moment returned by the create call. Set only for
   * `status: 'delivered'` — retained until the timeline window renders the
   * id and the screen acknowledges it. Never faked before the API returns.
   */
  deliveredMoment?: Moment | null;
};

export type UploadFn = (
  input: { uri: string; mimeType: string },
  onProgress?: (fraction: number) => void,
  assertScope?: () => void
) => Promise<{ mediaId: string | null; url: string }>;

export type { MomentAttachment as ResponseAttachment };
