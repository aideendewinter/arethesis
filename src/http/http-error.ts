/**
 * HttpError: a failed request, with status and parsed body.
 *
 * @module http/http-error
 */

export type HttpErrorKind = 'http' | 'network' | 'timeout' | 'parse';

export interface HttpErrorDetails {
  body?: unknown;
  url?: string;
  method?: string;
  kind?: HttpErrorKind;
  /** Seconds from a `Retry-After` header. */
  retryAfter?: number;
}

export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number;
  readonly body: unknown;
  readonly url?: string;
  readonly method?: string;
  readonly kind: HttpErrorKind;
  readonly retryAfter?: number;

  constructor(message: string, status: number, details: HttpErrorDetails = {}) {
    super(message);
    this.status = status;
    this.body = details.body;
    this.url = details.url;
    this.method = details.method;
    this.kind = details.kind ?? (status === 0 ? 'network' : 'http');
    this.retryAfter = details.retryAfter;
  }

  /** 4xx */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** 5xx */
  get isServerError(): boolean {
    return this.status >= 500;
  }

  /** The request never got a response. */
  get isNetworkError(): boolean {
    return this.kind === 'network';
  }

  get isTimeout(): boolean {
    return this.kind === 'timeout';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** A message from the body (`message`, `error`, `detail`), else the status text. */
  get displayMessage(): string {
    const b = this.body as Record<string, unknown> | undefined;
    if (b && typeof b === 'object') {
      for (const key of ['message', 'error', 'detail', 'title']) {
        if (typeof b[key] === 'string') return b[key] as string;
      }
    }
    return this.message;
  }
}
