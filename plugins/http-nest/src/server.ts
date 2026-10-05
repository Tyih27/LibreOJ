import "reflect-metadata";

import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Router, type NextFunction, type Request, type Response } from "express";

import type {
  HttpHandler,
  HttpMethod,
  HttpMiddleware,
  HttpRequest,
  HttpResponse,
  HttpServer
} from "@libreoj/plugin-api";

/** Options for {@link HttpNestServer}. */
export interface HttpNestOptions {
  /**
   * The Nest module to mount -- typically the application's existing root module. When omitted, an empty module is
   * used, so a purely plugin-contributed server needs no Nest module of its own.
   */
  rootModule?: unknown;
  host?: string;
  port?: number;
}

/** Root module used when the caller contributes no Nest module of its own. */
@Module({})
class EmptyModule {}

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
 * on a Nest application built from the configured root module. This keeps plugin-contributed endpoints independent of
 * Nest's controller decorators and module graph, while the root module preserves an application's existing Nest
 * controllers unchanged.
 */
export class HttpNestServer implements HttpServer {
  private readonly routes: RouteEntry[] = [];
  private readonly middlewares: MiddlewareEntry[] = [];
  private app: INestApplication | null = null;
  private bound: { host: string; port: number } | null = null;

  constructor(private readonly options: HttpNestOptions = {}) {}

  get listening(): boolean {
    return this.app !== null;
  }

  get address(): { host: string; port: number } | null {
    return this.bound;
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

  async listen(): Promise<void> {
    if (this.app) return;

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

    const rootModule = (this.options.rootModule ?? EmptyModule) as Parameters<typeof NestFactory.create>[0];
    const app = await NestFactory.create(rootModule, { logger: false });
    app.use(router);
    if (this.options.host) await app.listen(this.options.port ?? 0, this.options.host);
    else await app.listen(this.options.port ?? 0);

    const address = app.getHttpServer().address();
    this.bound =
      address && typeof address === "object" ? { host: this.options.host ?? "0.0.0.0", port: address.port } : null;
    this.app = app;
  }

  async close(): Promise<void> {
    const app = this.app;
    this.app = null;
    this.bound = null;
    if (app) await app.close();
  }

  private assertMutable(): void {
    if (this.app) throw new Error("Cannot register routes or middleware after HttpServer.listen()");
  }
}
