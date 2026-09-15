import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  badRequest,
  conflict,
  forbidden,
  internal,
  notFound,
  tooManyRequests,
  toApiError,
  unauthorized,
} from '../../domains/errors';

describe('toApiError mapping table', () => {
  const cases: Array<{ err: unknown; status: number; code: string; message: string }> = [
    { err: badRequest('Word only'), status: 400, code: 'BAD_REQUEST', message: 'Word only' },
    { err: unauthorized('Nope'), status: 401, code: 'UNAUTHORIZED', message: 'Nope' },
    { err: forbidden(), status: 403, code: 'FORBIDDEN', message: 'Forbidden' },
    { err: notFound(), status: 404, code: 'NOT_FOUND', message: 'Not found' },
    { err: conflict('Taken'), status: 409, code: 'CONFLICT', message: 'Taken' },
    { err: tooManyRequests(), status: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
    { err: internal(new Error('secret detail')), status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
  ];

  it.each(cases)('maps %s → $status $code', ({ err, status, code, message }) => {
    const mapped = toApiError(err);
    expect(mapped.status).toBe(status);
    expect(mapped.body).toEqual({ error: { code, message } });
  });

  it('maps unknown thrown values to a fixed 500 with a fixed message', () => {
    const mapped = toApiError(new Error('V8 JSON.parse SyntaxError: unexpected token at position 5'));
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.message).toBe('Internal server error');
    expect(mapped.body.error.message).not.toContain('SyntaxError');
  });

  it('maps plain strings and null to a fixed 500', () => {
    for (const value of ['boom', null, undefined, 42]) {
      const mapped = toApiError(value);
      expect(mapped.status).toBe(500);
      expect(mapped.body.error.message).toBe('Internal server error');
    }
  });

  it('never leaks err.message for InternalError even with sensitive causes', () => {
    const mapped = toApiError(
      internal(new Error('latitude 37.7749 longitude -122.4194 refresh_token=abc123'))
    );
    expect(mapped.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(mapped)).not.toMatch(/latitude|longitude|refresh_token/);
  });

  it('unwraps Effect FiberFailure (runPromise rejection) before mapping', async () => {
    // Effect.runPromise rejects with a FiberFailure wrapper, not the raw
    // error. Without unwrapping, every typed route failure through run()
    // mapped to a 500 (regression pin — see routes/session-auth.test.ts).
    try {
      await Effect.runPromise(Effect.fail(conflict('Taken')));
      throw new Error('expected rejection');
    } catch (err) {
      const mapped = toApiError(err);
      expect(mapped.status).toBe(409);
      expect(mapped.body).toEqual({ error: { code: 'CONFLICT', message: 'Taken' } });
    }
  });

  it('exposes typed constructors as Data.TaggedError instances', () => {
    expect(badRequest('x')).toBeInstanceOf(BadRequestError);
    expect(unauthorized()).toBeInstanceOf(UnauthorizedError);
    expect(forbidden()).toBeInstanceOf(ForbiddenError);
    expect(notFound()).toBeInstanceOf(NotFoundError);
    expect(conflict('x')).toBeInstanceOf(ConflictError);
    expect(tooManyRequests()).toBeInstanceOf(TooManyRequestsError);
    expect(internal()).toBeInstanceOf(InternalError);
  });
});
