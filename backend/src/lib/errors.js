export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}
export const bad = (m, d) => new ApiError(400, 'BAD_REQUEST', m, d);
export const unauth = (m = 'Sign in required.') => new ApiError(401, 'UNAUTHENTICATED', m);
export const forbidden = (m = 'Not allowed.') => new ApiError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found.') => new ApiError(404, 'NOT_FOUND', m);
export const conflict = (m, code = 'CONFLICT') => new ApiError(409, code, m);
export const tooMany = (m = 'Too many attempts. Try again later.') => new ApiError(429, 'RATE_LIMITED', m);
export const unavailable = (m, code = 'UNAVAILABLE') => new ApiError(503, code, m);
