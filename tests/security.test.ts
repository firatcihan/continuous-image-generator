import { describe, expect, it } from 'vitest';
import { readCookieToken, isRequestAuthorized, generateToken } from '../src/server/security.js';

const EXPECTED = { token: 'gizli123', allowedOrigin: 'http://127.0.0.1:3000' };

describe('isRequestAuthorized', () => {
  it('accepts the correct token with the allowed origin', () => {
    expect(isRequestAuthorized({ token: 'gizli123', origin: 'http://127.0.0.1:3000' }, EXPECTED)).toBe(true);
  });

  it('accepts when the Origin header is absent', () => {
    expect(isRequestAuthorized({ token: 'gizli123' }, EXPECTED)).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(isRequestAuthorized({ token: 'yanlis' }, EXPECTED)).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(isRequestAuthorized({}, EXPECTED)).toBe(false);
  });

  it('rejects a foreign origin (a malicious site firing at localhost)', () => {
    expect(isRequestAuthorized({ token: 'gizli123', origin: 'https://kotu-site.com' }, EXPECTED)).toBe(false);
  });

  it('rejects a localhost origin on a different port', () => {
    expect(isRequestAuthorized({ token: 'gizli123', origin: 'http://127.0.0.1:9999' }, EXPECTED)).toBe(false);
  });
});

describe('generateToken', () => {
  it('generates a token long enough and different every time', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  it('generates URL-safe characters', () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('readCookieToken', () => {
  it('reads the t cookie', () => {
    expect(readCookieToken('t=abc123')).toBe('abc123');
  });

  it('finds t among multiple cookies', () => {
    expect(readCookieToken('digeri=1; t=abc123; baska=2')).toBe('abc123');
  });

  it('preserves equals signs inside a base64url value', () => {
    expect(readCookieToken('t=a=b=c')).toBe('a=b=c');
  });

  it('returns undefined when the header or t is missing', () => {
    expect(readCookieToken(undefined)).toBeUndefined();
    expect(readCookieToken('digeri=1')).toBeUndefined();
  });

  it('does not mistake another cookie whose name starts with t for t', () => {
    expect(readCookieToken('token=yanlis')).toBeUndefined();
  });
});
