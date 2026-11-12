import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken } from '../utils/passwords.js';

describe('Password and Token Utilities', () => {
  it('hashes passwords securely using pbkdf2 and verifies correctly', () => {
    const raw = 'SuperSecret123!';
    const hashed = hashPassword(raw);

    expect(hashed).toContain('pbkdf2$100000$');
    expect(verifyPassword(raw, hashed)).toBe(true);
    expect(verifyPassword('WrongPassword', hashed)).toBe(false);
    expect(verifyPassword('', hashed)).toBe(false);
  });

  it('rejects tampered or invalid password hashes gracefully', () => {
    expect(verifyPassword('test', 'not-a-valid-hash')).toBe(false);
    expect(verifyPassword('test', 'pbkdf2$bad$format')).toBe(false);
  });

  it('generates random session tokens and deterministic hashes', () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();

    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);

    const hash1 = hashSessionToken(token1);
    const hash2 = hashSessionToken(token1);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});

