import { describe, it, expect } from 'vitest';
import { isExpoPushToken, parsePushNotificationData } from '@aoi/shared';

describe('isExpoPushToken', () => {
  it('accepts the legacy ExponentPushToken format', () => {
    expect(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
  });

  it('accepts the current ExpoPushToken format with mixed characters', () => {
    expect(isExpoPushToken('ExpoPushToken[Abc123_-xyz]')).toBe(true);
  });

  it('rejects empty brackets', () => {
    expect(isExpoPushToken('ExpoPushToken[]')).toBe(false);
  });

  it('rejects missing brackets', () => {
    expect(isExpoPushToken('ExpoPushTokenAbc123')).toBe(false);
  });

  it('rejects unknown prefixes and arbitrary strings', () => {
    expect(isExpoPushToken('APNSToken[abc123]')).toBe(false);
    expect(isExpoPushToken('hello')).toBe(false);
    expect(isExpoPushToken('')).toBe(false);
  });

  it('rejects tokens with spaces or shell-shaped characters', () => {
    expect(isExpoPushToken('ExpoPushToken[abc 123]')).toBe(false);
    expect(isExpoPushToken('ExpoPushToken[abc;rm]')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isExpoPushToken(null)).toBe(false);
    expect(isExpoPushToken(undefined)).toBe(false);
    expect(isExpoPushToken(42)).toBe(false);
    expect(isExpoPushToken({ data: 'ExpoPushToken[abc]' })).toBe(false);
  });
});

describe('parsePushNotificationData', () => {
  it('recognizes every known kind', () => {
    for (const kind of ['squeeze', 'moment_added', 'moment_edited', 'moment_deleted']) {
      expect(parsePushNotificationData({ kind })).toEqual({ kind });
    }
  });

  it('ignores unknown kinds — receivers never act on them', () => {
    expect(parsePushNotificationData({ kind: 'location_request' })).toBeNull();
    expect(parsePushNotificationData({ kind: '' })).toBeNull();
  });

  it('ignores malformed payloads', () => {
    expect(parsePushNotificationData(undefined)).toBeNull();
    expect(parsePushNotificationData(null)).toBeNull();
    expect(parsePushNotificationData('squeeze')).toBeNull();
    expect(parsePushNotificationData({ kind: 7 })).toBeNull();
    expect(parsePushNotificationData({})).toBeNull();
  });

  it('carries kind only — never content', () => {
    const parsed = parsePushNotificationData({
      kind: 'moment_added',
      body: 'secret moment text that must never travel',
    });
    expect(parsed).toEqual({ kind: 'moment_added' });
    expect(JSON.stringify(parsed)).not.toContain('secret moment text');
  });
});
