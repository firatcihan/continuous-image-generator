import { randomBytes } from 'node:crypto';

export interface AuthInput {
  token?: string;
  origin?: string;
}

export interface AuthExpectation {
  token: string;
  allowedOrigin: string;
}

/**
 * The local server controls a browser carrying the user's ChatGPT session.
 * While the user browses a malicious site, that site's JavaScript can fire
 * requests at 127.0.0.1; the token and Origin checks block that.
 */
export function isRequestAuthorized(input: AuthInput, expected: AuthExpectation): boolean {
  if (input.token !== expected.token) return false;
  if (input.origin !== undefined && input.origin !== expected.allowedOrigin) return false;
  return true;
}

export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Reads the `t` cookie from the `Cookie` header. A need too small to justify
 * a separate dependency (fastify-cookie).
 */
export function readCookieToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;

  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals === -1) continue;
    if (part.slice(0, equals).trim() !== 't') continue;
    // a base64url token may contain `=`; everything after the first `=` is the value
    return part.slice(equals + 1);
  }
  return undefined;
}
