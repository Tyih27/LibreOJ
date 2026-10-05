import { Router, type NextFunction, type Request, type Response } from "express";

import type {
  HttpHandler,
  HttpMethod,
  HttpMiddleware,
  HttpRequest,
  HttpResponse,
  HttpServer
} from "@libreoj/plugin-api";

/**
 * Minimal structural view of a Nest application, so this provider adapts a Nest runtime the consumer already owns
 * instead of importing a Nest copy of its own. That keeps a single `@nestjs/core` instance in the process, which is
 * required for Nest's injector to resolve internal providers such as `ModuleRef`.
 */
export interface NestApplicationLike {
  use(...args: unknown[]): unknown;
  listen(port?: number, host?: string): Promise<unknown>;
  getHttpServer(): { address(): unknown };
  get<T = unknown>(token: unknown): T;
  close(): Promise<void>;
}

/** Creates a Nest application from a root module, using the caller's Nest instance. */
export interface NestFactoryLike {
  create(module: unknown, options?: unknown): Promise<NestApplicationLike>;
}

/** Options for {@link HttpNestServer}. */
export interface HttpNestOptions {
  /** The Nest module to mount -- typically the application's existing root module. */
  rootModule: unknown;
  /** The caller's Nest runtime, so this provider shares the application's single Nest instance. */
  nest: NestFactoryLike;
  host?: string;
  port?: number;
  /**
   * Called with the freshly created Nest application, after it is created and before the contributed routes are
   * mounted and the port is bound. Lets an application install its global prefix, filters, pipes or Swagger exactly as
   * it would on a directly created application.
   */
  configureApp?: (app: NestApplicationLike) => void | Promise<void>;
  /**
   * Whether the provider binds a port during its `start` phase. When `false` the Nest application is still created and
   * configured -- and available through {@link HttpNestServer.application} -- but is left unbound. Defaults to `true`.
   */
  listen?: boolean;
  /**
   * Options passed to the caller's `nest.create`. When omitted, `{ logger: false }` is used so a test or a purely
   * programmatic server stays silent; an explicit empty object opts back into Nest's default logger.
   */
  nestOptions?: unknown;
}

interface RouteEntry {
  method: HttpMethod;
  path: string;
  handler: HttpHandler;
}

interface MiddlewareEntry {
  middleware: HttpMiddleware;
}

type RouterMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";

function toRequest(request: Request): HttpRequest {
  return {
    method: request.method,
    path: request.path,
    headers: request.headers as Record<string, string | string[] | undefined>,
    query: request.query as Record<string, unknown>,
    params: request.params as Record<string, string>,
    body: request.body,
    raw: request
  };
}

function applyResponse(response: Response, normalized: HttpResponse): void {
  response.status(normalized.status);
  for (const [name, value] of Object.entries(normalized.headers)) response.setHeader(name, value);

  if (normalized.body === undefined || normalized.body === null) response.end();
  else if (typeof normalized.body === "string" || Buffer.isBuffer(normalized.body)) response.send(normalized.body);
  else response.json(normalized.body);
}

const RESPONSE_KEY = Symbol("libreoj.http.response");

/**
 * Returns the normalized response shared by every middleware and the terminal route for one Express request, so a
 * header or status set by middleware is preserved when the route writes the body.
 */
function responseFor(response: Response): HttpResponse {
  const locals = response.locals as Record<PropertyKey, unknown>;
  if (!locals[RESPONSE_KEY]) locals[RESPONSE_KEY] = { status: 200, headers: {} } as HttpResponse;
  return locals[RESPONSE_KEY] as HttpResponse;
}

/**
 * The `http` seam's NestJS Provider.
 *
 * A server owns an Express `Router` pre-populated with the routes and middleware plugins contributed, then mounts it
 * on a Nest application the caller's own Nest runtime creates from the configured root module. This keeps
 * plugin-contributed endpoints independent of Nest's controller decorators and module graph, while the root module
 * preserves an application's existing Nest controllers unchanged -- and, because the caller supplies the Nest runtime,
 * the process keeps a single Nest instance.
 */
export class HttpNestServer implements HttpServer {
  private readonly routes: RouteEntry[] = [];
  private readonly middlewares: MiddlewareEntry[] = [];
  private app: NestApplicationLike | null = null;
  private bound: { host: string; port: number } | null = null;
  private preparing: Promise<NestApplicationLike> | null = null;

  constructor(private readonly options: HttpNestOptions) {}

  get listening(): boolean {
    return this.bound !== null;
  }

  get address(): { host: string; port: number } | null {
    return this.bound;
  }

  /** The created Nest application once {@link prepare} (or {@link listen}) has run, otherwise `null`. */
  get application(): NestApplicationLike | null {
    return this.app;
  }

  route(method: HttpMethod, path: string, handler: HttpHandler): () => void {
    this.assertMutable();
    const entry: RouteEntry = { method, path, handler };
    this.routes.push(entry);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.routes.indexOf(entry);
      if (index >= 0) this.routes.splice(index, 1);
    };
  }

  use(middleware: HttpMiddleware): () => void {
    this.assertMutable();
    const entry: MiddlewareEntry = { middleware };
    this.middlewares.push(entry);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.middlewares.indexOf(entry);
      if (index >= 0) this.middlewares.splice(index, 1);
    };
  }

  /**
   * Creates and configures the Nest application without binding a port. Idempotent, and the first step of
   * {@link listen}; exposed so a caller can hold a configured application -- for example to run a migration -- and
   * bind later, or never.
   */
  async prepare(): Promise<void> {
    if (this.app) return;
    if (!this.preparing) {
      this.preparing = this.createApplication();
      // A failed prepare must not poison later attempts; the awaited rejection still reaches the caller.
      this.preparing.catch(() => {
        this.preparing = null;
      });
    }
    await this.preparing;
  }

  async listen(): Promise<void> {
    if (this.bound) return;

    await this.prepare();

    const app = this.app;
    if (!app) throw new Error("HttpNestServer application was not created");

    if (this.options.host) await app.listen(this.options.port ?? 0, this.options.host);
    else await app.listen(this.options.port ?? 0);

    const address = app.getHttpServer().address();
    this.bound =
      address && typeof address === "object"
        ? { host: this.options.host ?? "0.0.0.0", port: (address as { port: number }).port }
        : null;
  }

  async close(): Promise<void> {
    const app = this.app;
    this.app = null;
    this.preparing = null;
    this.bound = null;
    if (app) await app.close();
  }

  private async createApplication(): Promise<NestApplicationLike> {
    const router = this.buildRouter();
    const app = await this.options.nest.create(this.options.rootModule, this.options.nestOptions ?? { logger: false });

    try {
      if (this.options.configureApp) await this.options.configureApp(app);
      app.use(router);
    } catch (error) {
      await app.close();
      throw error;
    }

    this.app = app;
    return app;
  }

  private buildRouter(): Router {
    const router = Router();

    for (const { middleware } of this.middlewares) {
      router.use((request: Request, response: Response, next: NextFunction) => {
        const normalized = responseFor(response);
        let proceeded = false;
        Promise.resolve(
          middleware(toRequest(request), normalized, () => {
            proceeded = true;
          })
        )
          .then(() => (proceeded ? next() : applyResponse(response, normalized)))
          .catch(next);
      });
    }

    for (const { method, path, handler } of this.routes) {
      const registrar = router[method.toLowerCase() as RouterMethod] as (
        path: string,
        handler: (request: Request, response: Response, next: NextFunction) => void
      ) => void;

      registrar.call(router, path, (request: Request, response: Response, next: NextFunction) => {
        const normalized = responseFor(response);
        Promise.resolve(handler(toRequest(request), normalized))
          .then(() => applyResponse(response, normalized))
          .catch(next);
      });
    }

    return router;
  }

  private assertMutable(): void {
    if (this.app) throw new Error("Cannot register routes or middleware after HttpServer.listen()");
  }
}
