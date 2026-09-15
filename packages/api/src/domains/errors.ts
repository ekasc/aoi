import { Data, Option } from 'effect';
import * as Cause from 'effect/Cause';
import * as Runtime from 'effect/Runtime';

import type { ApiError } from '@aoi/shared';

/**
 * Typed domain errors. Every HTTP code a route can return is a
 * `Data.TaggedError` here; routes/domains fail with these, and the transport
 * layer (`create-app.ts`) maps them to the canonical `{ error: { code,
 * message } }` envelope.
 *
 * Privacy invariants (non-negotiable):
 * - 400-family `message` values are FIXED, word-only strings — never request
 *   content, never coordinates, never stack traces.
 * - Anything not one of these errors maps to a FIXED 500 with a fixed
 *   message; `err.message` never reaches the wire.
 */

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'TOO_MANY_REQUESTS',
  'LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class BadRequestError extends Data.TaggedError('BadRequestError')<{
  readonly message: string;
}> {}

export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  readonly message: string;
}> {}

export class ForbiddenError extends Data.TaggedError('ForbiddenError')<{
  readonly message: string;
}> {}

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly message: string;
}> {}

export class ConflictError extends Data.TaggedError('ConflictError')<{
  readonly message: string;
}> {}

export class TooManyRequestsError extends Data.TaggedError('TooManyRequestsError')<{
  readonly message: string;
}> {}

/**
 * Plus-limit rejection (media quota, future-letter allowance). Carries
 * machine-readable `details` (see LimitDetails) so the client can explain
 * the exact limit reached and offer Plus — numbers only, never storage
 * internals or other-Space data. HTTP 403: the caller is authenticated but
 * the Space tier does not allow this operation.
 */
export class LimitExceededError extends Data.TaggedError('LimitExceededError')<{
  readonly message: string;
  readonly details: import('@aoi/shared').LimitDetails;
}> {}

/** Internal errors carry no message — the transport uses a fixed string. */
export class InternalError extends Data.TaggedError('InternalError')<{
  readonly cause?: unknown;
}> {}

export type DomainError =
  | BadRequestError
  | UnauthorizedError
  | ForbiddenError
  | NotFoundError
  | ConflictError
  | TooManyRequestsError
  | LimitExceededError
  | InternalError;

/** Word-only 400 helper (message is rendered by the client verbatim). */
export function badRequest(message: string): BadRequestError {
  return new BadRequestError({ message });
}

export function unauthorized(message = 'Unauthorized'): UnauthorizedError {
  return new UnauthorizedError({ message });
}

export function forbidden(message = 'Forbidden'): ForbiddenError {
  return new ForbiddenError({ message });
}

export function notFound(message = 'Not found'): NotFoundError {
  return new NotFoundError({ message });
}

export function conflict(message: string): ConflictError {
  return new ConflictError({ message });
}

export function tooManyRequests(message = 'Too many requests'): TooManyRequestsError {
  return new TooManyRequestsError({ message });
}

export function limitExceeded(
  message: string,
  details: import('@aoi/shared').LimitDetails
): LimitExceededError {
  return new LimitExceededError({ message, details });
}

export function internal(cause?: unknown): InternalError {
  return new InternalError({ cause });
}

export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/** Fixed, word-only message per 400-family error. */
function messageFor(err: DomainError): string {
  switch (err._tag) {
    case 'BadRequestError':
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'NotFoundError':
    case 'ConflictError':
    case 'TooManyRequestsError':
      return err.message;
    case 'LimitExceededError':
      return err.message;
    case 'InternalError':
      return INTERNAL_ERROR_MESSAGE;
  }
}

/** Fixed code per error (mirrors the legacy app.ts httpCodeToErrorCode). */
function codeFor(err: DomainError): ApiErrorCode {
  switch (err._tag) {
    case 'BadRequestError':
      return 'BAD_REQUEST';
    case 'UnauthorizedError':
      return 'UNAUTHORIZED';
    case 'ForbiddenError':
      return 'FORBIDDEN';
    case 'NotFoundError':
      return 'NOT_FOUND';
    case 'ConflictError':
      return 'CONFLICT';
    case 'TooManyRequestsError':
      return 'TOO_MANY_REQUESTS';
    case 'LimitExceededError':
      return 'LIMIT_EXCEEDED';
    case 'InternalError':
      return 'INTERNAL_ERROR';
  }
}

export interface ApiErrorResponse {
  status: ApiErrorStatus;
  body: ApiError;
}

/** Statuses the API can actually produce (Hono-typed). */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;

export function statusFor(err: DomainError): ApiErrorStatus {
  switch (err._tag) {
    case 'BadRequestError':
      return 400;
    case 'UnauthorizedError':
      return 401;
    case 'ForbiddenError':
      return 403;
    case 'NotFoundError':
      return 404;
    case 'ConflictError':
      return 409;
    case 'TooManyRequestsError':
      return 429;
    case 'LimitExceededError':
      return 403;
    case 'InternalError':
      return 500;
  }
}

/**
 * Effect's `runPromise` rejects with a `FiberFailure` wrapper (the raw
 * failure value lives in its Cause). Unwrap it so `instanceof` mapping
 * works — otherwise every typed route failure through `run()` maps to a
 * 500 (verified empirically: the rejection is FiberFailureImpl, not the
 * `Data.TaggedError` instance).
 */
function unwrapFailure(value: unknown): unknown {
  if (Runtime.isFiberFailure(value)) {
    const cause = value[Runtime.FiberFailureCauseId];
    const failure = Cause.failureOption(cause);
    if (Option.isSome(failure)) {
      return failure.value;
    }
  }
  return value;
}

/**
 * Map a thrown/defeated value to the canonical error envelope. Unknown
 * values (bugs, thrown strings, zod errors leaking) always become a fixed
 * 500 — the message never varies, so no request content ever leaks.
 */
export function toApiError(rawValue: unknown): ApiErrorResponse {
  const value = unwrapFailure(rawValue);
  if (value instanceof BadRequestError ||
      value instanceof UnauthorizedError ||
      value instanceof ForbiddenError ||
      value instanceof NotFoundError ||
      value instanceof ConflictError ||
      value instanceof TooManyRequestsError ||
      value instanceof LimitExceededError ||
      value instanceof InternalError) {
    const body: ApiError = {
      error: {
        code: codeFor(value),
        message: messageFor(value),
        ...(value instanceof LimitExceededError ? { details: value.details } : {}),
      },
    };
    return { status: statusFor(value), body };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE } },
  };
}
