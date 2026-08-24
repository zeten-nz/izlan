/** Typed API error. `code` is the backend's stable machine-readable string; branch on it, never on `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** A network/transport failure (fetch rejected) — distinct from an HTTP error response. */
export class NetworkError extends Error {
  constructor(message = 'network error') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Raised when a request needs auth but no session could be established (refresh failed / no token). */
export class UnauthenticatedError extends ApiError {
  constructor() {
    super(401, 'AUTH_UNAUTHORIZED', 'unauthorized');
    this.name = 'UnauthenticatedError';
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
/**
 * True for a cancelled/aborted request (AbortController / navigation). Checked by `.name` (not `instanceof`) because
 * an AbortError is a DOMException whose prototype chain varies across runtimes. A cancel is not a real failure — it
 * must never be presented to the user as one (and never as a network error).
 */
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}
export function isEditConflict(e: unknown): boolean {
  return isApiError(e) && e.code === 'CONTENT_EDIT_CONFLICT';
}
export function isLifecycleConflict(e: unknown): boolean {
  return isApiError(e) && (e.code === 'CONTENT_LIFECYCLE_CONFLICT' || e.code === 'CONTENT_NOT_DRAFT');
}
export function isNotFound(e: unknown): boolean {
  return isApiError(e) && e.status === 404;
}
export function isForbidden(e: unknown): boolean {
  return isApiError(e) && e.status === 403;
}
