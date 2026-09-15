import { describe, expect, it, vi } from 'vitest';

import { buildCreateInput, sendPendingRecord } from '@/features/composer/send-pipeline';
import { canAutoRetry } from '@/features/composer/composer-machine';
import type { ComposerScope, PendingRecord } from '@/features/composer/types';

const scopeA: ComposerScope = { viewerId: 'user_a', spaceId: 'space_1' };
const scopeB: ComposerScope = { viewerId: 'user_b', spaceId: 'space_1' };

function makeRecord(): PendingRecord {
  return {
    clientId: 'moment_send-1',
    body: 'hello',
    occurredAt: '2026-03-15T10:00:00.000Z',
    slots: [
      {
        stagedId: 'staged_1',
        kind: 'image',
        mimeType: 'image/jpeg',
        localUri: 'composer/user_a/space_1/staged/staged_1.jpg',
        uploaded: null,
      },
      {
        stagedId: 'staged_2',
        kind: 'audio',
        mimeType: 'audio/m4a',
        localUri: 'composer/user_a/space_1/staged/staged_2.m4a',
        uploaded: null,
      },
    ],
    status: 'queued',
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    scope: { ...scopeA },
  };
}

describe('composer send pipeline', () => {
  it('retries with the same clientId and reuses uploaded checkpoints (no re-upload)', async () => {
    const record = makeRecord();
    const upload = vi.fn(async ({ uri }: { uri: string }) => {
      if (uri.endsWith('staged_1.jpg')) {
        return { mediaId: '11111111-1111-4111-8111-111111111111', url: '/v1/media/11111111-1111-4111-8111-111111111111/object?variant=display' };
      }
      throw Object.assign(new Error('network down'), { code: 'NETWORK' });
    });
    const create = vi.fn(async () => {
      throw new Error('unreachable');
    });
    const checkpoints: string[] = [];
    await expect(
      sendPendingRecord(record, { upload, create, getCurrentScope: () => ({ ...scopeA }) }, async (c) => {
        checkpoints.push(c.stagedId);
      })
    ).rejects.toThrow();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(checkpoints).toEqual(['staged_1']);

    // Retry: first slot checkpointed — upload runs only for slot 2.
    const resumed: PendingRecord = {
      ...record,
      slots: [
        { ...record.slots[0], uploaded: { mediaId: '11111111-1111-4111-8111-111111111111', url: '/v1/media/11111111-1111-4111-8111-111111111111/object?variant=display' } },
        { ...record.slots[1] },
      ],
    };
    upload.mockClear();
    upload.mockImplementation(async ({ uri }: { uri: string }) => {
      if (uri.endsWith('staged_2.m4a')) {
        return { mediaId: '22222222-2222-4222-8222-222222222222', url: '/v1/media/22222222-2222-4222-8222-222222222222/object?variant=original' };
      }
      throw new Error(`unexpected re-upload: ${uri}`);
    });
    create.mockResolvedValue({ id: 'moment-9' } as never);
    const moment = await sendPendingRecord(resumed, { upload, create, getCurrentScope: () => ({ ...scopeA }) });
    expect(moment).toEqual({ id: 'moment-9' });
    expect(upload).toHaveBeenCalledTimes(1);
    // Stable clientId idempotency key survives the retry.
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].clientId).toBe('moment_send-1');
    expect(create.mock.calls[0][0].attachments).toEqual([
      { mediaId: '11111111-1111-4111-8111-111111111111', kind: 'image' },
      { mediaId: '22222222-2222-4222-8222-222222222222', kind: 'audio' },
    ]);
  });

  it('mid-create failure keeps the same clientId for the next retry', async () => {
    const record: PendingRecord = {
      ...makeRecord(),
      slots: [
        {
          stagedId: 'staged_1',
          kind: 'image',
          mimeType: 'image/jpeg',
          localUri: 'composer/user_a/space_1/staged/staged_1.jpg',
          uploaded: { mediaId: '11111111-1111-4111-8111-111111111111', url: '/v1/media/x/object?variant=display' },
        },
      ],
    };
    const upload = vi.fn();
    const create = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      sendPendingRecord(record, { upload, create, getCurrentScope: () => ({ ...scopeA }) })
    ).rejects.toThrow('boom');
    expect(upload).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].clientId).toBe('moment_send-1');
  });

  it('scope switch aborts before every network step (no credential leakage)', async () => {
    const record = makeRecord();
    let current: ComposerScope | null = { ...scopeA };
    const upload = vi.fn(async () => ({ mediaId: '11111111-1111-4111-8111-111111111111', url: 'u' }));
    const create = vi.fn(async () => ({ id: 'm' }) as never);
    // Switch accounts after the first upload resolves.
    upload.mockImplementationOnce(async () => {
      current = { ...scopeB };
      return { mediaId: '11111111-1111-4111-8111-111111111111', url: 'u' };
    });
    await expect(
      sendPendingRecord(record, { upload, create, getCurrentScope: () => current })
    ).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    // Second upload + create never ran on the new scope's credentials.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('create validates scope too (stale sender never fires)', async () => {
    const record: PendingRecord = { ...makeRecord(), slots: [] };
    const create = vi.fn(async () => ({ id: 'm' }) as never);
    await expect(
      sendPendingRecord(record, {
        upload: vi.fn(),
        create,
        getCurrentScope: () => ({ ...scopeB }),
      })
    ).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    expect(create).not.toHaveBeenCalled();
  });

  it('foreground auto-retries queued only; failed needs explicit retry', () => {
    expect(canAutoRetry('queued', 'active')).toBe(true);
    expect(canAutoRetry('queued', 'background')).toBe(false);
    expect(canAutoRetry('failed', 'active')).toBe(false);
    expect(canAutoRetry('sending', 'active')).toBe(false);
  });

  it('builds ordered image/audio attachments with legacy derivation', () => {
    const input = buildCreateInput({
      ...makeRecord(),
      slots: [
        {
          stagedId: 'staged_2',
          kind: 'audio',
          mimeType: 'audio/m4a',
          localUri: 'local-audio',
          uploaded: { mediaId: '22222222-2222-4222-8222-222222222222', url: '/v1/media/22222222-2222-4222-8222-222222222222/object?variant=original' },
        },
        {
          stagedId: 'staged_1',
          kind: 'image',
          mimeType: 'image/jpeg',
          localUri: 'local-image',
          uploaded: { mediaId: '11111111-1111-4111-8111-111111111111', url: '/v1/media/11111111-1111-4111-8111-111111111111/object?variant=display' },
        },
      ],
    });
    // Order preserved (audio first), legacy derived per-kind.
    expect(input.attachments?.map((a) => a.mediaId)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(input.mediaPreview).toContain('11111111-1111-4111-8111-111111111111');
    expect(input.audioUri).toContain('22222222-2222-4222-8222-222222222222');
    expect(input.clientId).toBe('moment_send-1');
  });
});
