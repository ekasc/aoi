import { beforeEach, describe, expect, it, vi } from 'vitest';

import { remoteMomentResponseRepository } from '@/features/responses/remote-moment-response-repository';
import type { CreateMomentResponseInput, MomentResponse } from '@/features/responses/types';

const mocks = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn() }));
vi.mock('@/features/api-client', () => ({ apiFetch: mocks.api }));
vi.mock('@/features/media/media-upload-service', () => ({ uploadMediaAsset: mocks.upload }));

const MEDIA = '00000000-0000-4000-8000-000000000001';
const input: CreateMomentResponseInput = { momentId: 'memory', authorId: 'forged-user', authorRole: 'you', authorName: 'Local', kind: 'tap' };
const response: MomentResponse = { id: 'response', momentId: 'memory', authorId: 'server-user', authorRole: 'you', authorName: 'You', kind: 'tap', body: null, mediaPreview: null, audioUri: null, createdAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => {
  mocks.api.mockReset().mockResolvedValue(response);
  mocks.upload.mockReset().mockResolvedValue({ mediaId: MEDIA, url: 'protected' });
});

describe('Remote response wire contract', () => {
  it('sends no client-authored identity or unused payload fields', async () => {
    expect(await remoteMomentResponseRepository.add(input)).toEqual(response);
    expect(mocks.api).toHaveBeenCalledWith('/v1/moments/memory/responses', { method: 'POST', body: '{"kind":"tap"}' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each([['photo', 'image/png'], ['voice', 'audio/m4a']] as const)('uploads %s before sending its media id', async (kind, mimeType) => {
    const addInput = { ...input, kind, mediaPreview: 'file:///photo.png', audioUri: 'file:///voice.m4a', mimeType };
    await remoteMomentResponseRepository.add(addInput);
    expect(mocks.upload.mock.calls[0][0]).toEqual({ uri: kind === 'photo' ? addInput.mediaPreview : addInput.audioUri, mimeType });
    const options = mocks.api.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ kind, mediaId: MEDIA });
    expect(options.body).not.toContain('file:');
  });

  it('rejects blank words before making a request', async () => {
    await expect(remoteMomentResponseRepository.add({ ...input, kind: 'word', body: ' ' })).rejects.toThrow();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('does not create a response after a failed upload or scope change', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('upload failed'));
    await expect(remoteMomentResponseRepository.add({ ...input, kind: 'photo', mediaPreview: 'file:///photo.jpg' })).rejects.toThrow();
    expect(mocks.api).not.toHaveBeenCalled();
    const assertScope = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error('space changed'); });
    await expect(remoteMomentResponseRepository.add({ ...input, kind: 'photo', mediaPreview: 'file:///photo.jpg' }, assertScope)).rejects.toThrow('space changed');
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('validates read responses at the network boundary', async () => {
    mocks.api.mockResolvedValueOnce({ responses: [] });
    expect(await remoteMomentResponseRepository.listForMoment('memory')).toEqual([]);
    mocks.api.mockResolvedValueOnce({ responses: [{ kind: 'unknown' }] });
    await expect(remoteMomentResponseRepository.listForMoment('memory')).rejects.toThrow();
  });
});
