import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeFaceReference, encodeFaceReference, getAutomaticAlbumStorage, parseScanDecisions } from '@/features/album/automatic-album-storage';
import { SFACE_MODEL_ID } from '@/features/album/face-recognition-engine';
import type { AlbumEnrollment } from '@/features/album/automatic-album';

const state = vi.hoisted(() => ({ secure: new Map<string, string>(), ordinary: new Map<string, string>(), writes: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: async (key: string) => state.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string, options: unknown) => { state.writes(key, value, options); state.secure.set(key, value); },
  deleteItemAsync: async (key: string) => { state.secure.delete(key); },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => state.ordinary.get(key) ?? null,
  setItem: async (key: string, value: string) => { state.ordinary.set(key, value); },
  removeItem: async (key: string) => { state.ordinary.delete(key); },
} }));
const vector = (index: number) => { const v = new Float32Array(128); v[index] = 1; return v; };
const enrollment: AlbumEnrollment = { modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] };
beforeEach(() => { state.secure.clear(); state.ordinary.clear(); state.writes.mockReset(); });

describe('protected automatic album setup', () => {
  it('roundtrips 128 floats in less than the SecureStore 2KB limit', () => {
    const encoded = encodeFaceReference(vector(0));
    expect(encoded.length).toBeLessThan(2048);
    expect(decodeFaceReference(encoded)).toEqual(vector(0));
    expect(() => decodeFaceReference('invalid')).toThrow();
  });
  it('keeps faceprints device-only and out of ordinary storage', async () => {
    const storage = getAutomaticAlbumStorage('scope');
    await storage.saveEnrollment(enrollment);
    expect(await storage.loadEnrollment()).toEqual(enrollment);
    expect(state.writes).toHaveBeenCalledWith(expect.any(String), expect.any(String), { keychainAccessible: 'device-only' });
    expect(state.ordinary.size).toBe(0);
  });
  it('isolates accounts/spaces and removes both faceprints when disabled', async () => {
    const a = getAutomaticAlbumStorage('a'); const b = getAutomaticAlbumStorage('b');
    await a.saveEnrollment(enrollment); expect(await b.loadEnrollment()).toBeNull();
    await a.forgetEnrollment(); expect(state.secure.size).toBe(0); expect(await a.loadEnrollment()).toBeNull();
  });
  it('retains removal/scan decisions across re-enrollment', async () => {
    const storage = getAutomaticAlbumStorage('scope');
    const decisions = { asset: { version: '1', photoIds: ['removed-photo'] } };
    await storage.saveDecisions(decisions); await storage.saveEnrollment(enrollment);
    expect(await storage.loadDecisions()).toEqual(decisions);
  });
  it('rejects a malformed persisted scan index', () => {
    for (const value of ['[]', '{"a":{"version":1,"photoIds":[]}}', '{"a":{"version":"1","photoIds":[5]}}']) expect(() => parseScanDecisions(value)).toThrow();
    expect(parseScanDecisions(null)).toEqual({});
  });
  it('keeps the previous enrollment usable if writing replacement references fails', async () => {
    const storage = getAutomaticAlbumStorage('scope');
    await storage.saveEnrollment(enrollment);
    state.writes.mockImplementation((key: string) => {
      if (key.endsWith('.refs.replacement.partner')) throw new Error('Keychain write failed');
    });
    await expect(storage.saveEnrollment({ ...enrollment, referenceId: 'replacement' })).rejects.toThrow('Keychain write failed');
    expect(await storage.loadEnrollment()).toEqual(enrollment);
    expect([...state.secure.keys()].some((key) => key.includes('.refs.replacement.'))).toBe(false);
  });
  it('roundtrips a replacement ID and deletes every tracked generation on disable', async () => {
    const storage = getAutomaticAlbumStorage('scope');
    await storage.saveEnrollment(enrollment);
    const replacement = { ...enrollment, referenceId: 'replacement' };
    await storage.saveEnrollment(replacement);
    expect(await storage.loadEnrollment()).toEqual(replacement);
    await storage.forgetEnrollment();
    expect(state.secure.size).toBe(0);
    expect(state.ordinary.size).toBe(0);
  });
});
