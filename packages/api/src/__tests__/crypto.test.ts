import { describe, it, expect } from 'vitest';
import { randomToken, hashToken, generateInviteCode, normalizeInviteCode } from '../lib/crypto.js';

describe('crypto utilities', () => {
  describe('randomToken', () => {
    it('generates a token of the requested length', () => {
      const token = randomToken(16);
      expect(token.length).toBe(32); // 16 bytes = 32 hex chars
    });

    it('generates unique tokens', () => {
      const a = randomToken(16);
      const b = randomToken(16);
      expect(a).not.toBe(b);
    });

    it('uses hex characters only', () => {
      const token = randomToken(32);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('generates 64-char token by default', () => {
      const token = randomToken();
      expect(token.length).toBe(64);
    });
  });

  describe('hashToken', () => {
    it('produces a SHA-256 hash', () => {
      const hash = hashToken('test-token');
      expect(hash.length).toBe(64); // 256 bits = 64 hex chars
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('is deterministic for same input', () => {
      const hash1 = hashToken('same-token');
      const hash2 = hashToken('same-token');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hashToken('token-a');
      const hash2 = hashToken('token-b');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateInviteCode', () => {
    it('generates a 6-character code', () => {
      const code = generateInviteCode();
      expect(code.length).toBe(6);
    });

    it('uses allowed characters only', () => {
      const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
      for (let i = 0; i < 100; i++) {
        expect(generateInviteCode()).toMatch(allowed);
      }
    });

    it('generates unique codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        codes.add(generateInviteCode());
      }
      expect(codes.size).toBeGreaterThan(990); // allow for collisions
    });

    it('excludes ambiguous characters (I, 1, O, 0)', () => {
      const code = generateInviteCode();
      expect(code).not.toContain('I');
      expect(code).not.toContain('1');
      expect(code).not.toContain('O');
      expect(code).not.toContain('0');
    });
  });

  describe('normalizeInviteCode', () => {
    it('uppercases the code', () => {
      expect(normalizeInviteCode('abc123')).toBe('ABC123');
    });

    it('removes spaces', () => {
      expect(normalizeInviteCode('AB C 123')).toBe('ABC123');
    });

    it('handles already normalized input', () => {
      expect(normalizeInviteCode('ABC123')).toBe('ABC123');
    });

    it('handles empty string', () => {
      expect(normalizeInviteCode('')).toBe('');
    });
  });
});
