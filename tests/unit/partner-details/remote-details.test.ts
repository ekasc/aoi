import { beforeEach, describe, expect, it, vi } from 'vitest';
import { partnerDetailsRepository } from '@/features/partner-details/partner-details-repository';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/features/api-client', () => ({ isStubMode: () => false, apiFetch: api }));

const local = { id: 'local-id', text: 'Tea', category: 'favorite' as const, createdAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => { api.mockReset(); });

describe('Remote private details', () => {
  it('lists the current user without accepting a user id on the wire', async () => {
    api.mockResolvedValue({ details: [] });
    expect(await partnerDetailsRepository.list('local-user')).toEqual([]);
    expect(api).toHaveBeenCalledWith('/v1/users/me/partner-details');
  });

  it('uses the server id and timestamp rather than local values', async () => {
    const saved = { ...local, id: 'server-id', createdAt: '2026-02-01T00:00:00.000Z' };
    api.mockResolvedValue(saved);
    expect(await partnerDetailsRepository.add('local-user', local)).toEqual(saved);
    expect(api).toHaveBeenCalledWith('/v1/users/me/partner-details', { method: 'POST', body: '{"text":"Tea","category":"favorite"}' });
  });

  it('propagates read and mutation failures instead of reporting empty or success', async () => {
    api.mockRejectedValue(new Error('offline'));
    await expect(partnerDetailsRepository.list('local-user')).rejects.toThrow('offline');
    await expect(partnerDetailsRepository.add('local-user', local)).rejects.toThrow('offline');
    await expect(partnerDetailsRepository.remove('local-user', local.id)).rejects.toThrow('offline');
  });
});
