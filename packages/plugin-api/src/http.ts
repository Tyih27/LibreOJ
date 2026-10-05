/**
 * Service Definition for the `http` seam.
 *
 * The seam is deliberately framework-neutral: a plugin contributes routes and middleware through plain functions and
 * reads a normalized request/response, while a Service Provider (today: `@libreoj/plugin-http-nest`) decides how to
 * mount them. Swapping the provider swaps the HTTP stack without touching the plugins that contribute to it.
 *
 * Route and middleware registration happens before `listen`; a provider may reject contributions after it starts, so
 * consumers should register during their `apply`.
 */

/** Service name an `HttpServer` provider registers under. */
export const HTTP = "http";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/** A normalized inbound request. `raw` carries the provider-specific request object for escape-hatch use. */
export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  params: Record<string, string>;
  body: unknown;
  raw?: unknown;
}

/** A normalized outbound response. A handler mutates `status`/`headers`/`body` in place. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

export type HttpHandler = (request: HttpRequest, response: HttpResponse) => void | Promise<void>;

export type HttpMiddleware = (
  request: HttpRequest,
  response: HttpResponse,
  next: () => void | Promise<void>
) => void | Promise<void>;

/** Removes a previously registered route or middleware. Idempotent. */
export type HttpDisposer = () => void;

export interface HttpServer {
  /** Registers a route. Returns a disposer; throws if called after {@link listen}. */
  route(method: HttpMethod, path: string, handler: HttpHandler): HttpDisposer;

  /** Registers middleware. Returns a disposer; throws if called after {@link listen}. */
  use(middleware: HttpMiddleware): HttpDisposer;

  /** Binds the server. Idempotent: a second call resolves immediately. */
  listen(): Promise<void>;

  /** Stops the server and releases its port. Idempotent. */
  close(): Promise<void>;

  readonly listening: boolean;

  /** The bound address once listening, otherwise `null`. */
  readonly address: { host: string; port: number } | null;
}
