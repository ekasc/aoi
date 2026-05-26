import { HTTPException } from 'hono/http-exception';

export function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}

export function unauthorized(message = 'Unauthorized'): HTTPException {
  return new HTTPException(401, { message });
}

export function forbidden(message = 'Forbidden'): HTTPException {
  return new HTTPException(403, { message });
}

export function notFound(message = 'Not found'): HTTPException {
  return new HTTPException(404, { message });
}

export function conflict(message: string): HTTPException {
  return new HTTPException(409, { message });
}

export function tooMany(message = 'Too many requests'): HTTPException {
  return new HTTPException(429, { message });
}

export function internal(message = 'Internal server error'): HTTPException {
  return new HTTPException(500, { message });
}
