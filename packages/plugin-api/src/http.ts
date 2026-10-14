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

/**
 * The DTO-bearing inputs of an {@link HttpRouteSpec}. Each entry names a class (a "model") whose properties describe
 * the accepted input; the provider turns it into validation rules and OpenAPI parameters/body. An absent entry means
 * the route accepts no input of that kind.
 */
export interface HttpRouteRequestSpec {
  /** Class describing the query string. */
  query?: unknown;
  /** Class describing path parameters. */
  params?: unknown;
  /** Class describing the JSON request body. */
  body?: unknown;
}

/**
 * A declarative, provider-agnostic description of one HTTP route.
 *
 * Unlike {@link HttpServer.route} — which carries only a method, a path and a handler — a route spec also states the
 * contract the handler expects (the DTO classes for query/path/body and the response) plus the documentation metadata
 * a provider needs (`tags`, `summary`, `operationId`, `auth`). It is deliberately framework-neutral; the provider
 * decides how to mount it and how to derive an OpenAPI path item from it.
 *
 * `path` is the controller+method path *without* the application's global prefix (e.g. `"/homepage/getHomepage"`). A
 * provider that applies a global prefix (the backend uses `"api"`) is responsible for prepending it.
 */
export interface HttpRouteSpec {
  method: HttpMethod;
  /** Controller+method path without the global prefix, e.g. `"/homepage/getHomepage"`. */
  path: string;
  /** OpenAPI group tags, e.g. `["Homepage"]`. */
  tags?: string[];
  summary?: string;
  /**
   * The OpenAPI `operationId`. The frontend API generator names each generated function after the segment following
   * the last `_`, so a route that must keep an already-shipped client stable has to reproduce the id the previous
   * provider produced (NestJS: `<ControllerClass>_<methodName>`).
   */
  operationId?: string;
  /** When `true`, the route requires bearer authentication (`@ApiBearerAuth()`). */
  auth?: boolean;
  request?: HttpRouteRequestSpec;
  /** Class describing the successful (2xx) response body. */
  response?: unknown;
  handler: HttpHandler;
}

/** Identity helper that pins a route spec's type at its definition site. */
export function defineRoute(spec: HttpRouteSpec): HttpRouteSpec {
  return spec;
}

/** Service name a route collector registers under. */
export const HTTP_ROUTES = "httpRoutes";

/**
 * Collects the route specs contributed by plugins. A provider reads {@link list} once, before `listen`, to build its
 * routing table and its OpenAPI document; registrations after that point are visible only to the next read.
 */
export interface HttpRouteRegistry {
  /** Registers a route, returning an idempotent disposer. */
  add(route: HttpRouteSpec): HttpDisposer;
  /** The currently registered routes, in registration order. */
  list(): HttpRouteSpec[];
}
