/**
 * The plugin that mounts declarative {@link HttpRouteSpec}s on the `http` seam.
 *
 * It provides the {@link HTTP_ROUTES} registry the backend's domain plugins contribute to, and mounts every registered
 * route on the seam's `HttpServer` (today the Express server owned by `@libreoj/plugin-http-nest`, in `M7.final` the
 * Nest-free provider). It depends only on the `http` seam, so swapping the provider does not touch it.
 *
 * Route mounting happens as specs are added rather than once in `start`: the `http-nest` provider creates (and freezes)
 * its Express router during the provider's own `start`, which the host runs before this plugin's `start` (plugins start
 * in load order). Every plugin's `apply` -- where domain plugins add their specs -- runs before *any* `start`, so
 * mounting on `add` is the only point at which the server is still mutable. `HttpRouteRegistry.list()` stays available
 * for the Nest-free OpenAPI generation.
 *
 * The backend's global `api` prefix is applied here: the seam mounts routes with raw `app.use(router)`, which Nest's
 * `setGlobalPrefix("api")` does not touch, so the bridge prepends `/api` to reproduce the public URL.
 *
 * The pipeline itself does not authenticate: it forwards the session the request pipeline populated. Because the seam
 * mounts its router before Nest's middleware runs, this plugin registers {@link createSeamAuthMiddleware} on the `http`
 * seam in its `apply`, so a migrated route observes the same `request.raw.session` (and async-local request context)
 * that a Nest middleware would have produced.
 */

import {
  HTTP,
  HTTP_ROUTES,
  type HttpDisposer,
  type HttpHandler,
  type HttpRouteRegistry,
  type HttpRouteSpec,
  type HttpServer
} from "@libreoj/plugin-api";
import type { PluginDefinition } from "@libreoj/plugin-core";

import { createSeamAuthMiddleware } from "./http/auth.middleware";
import { executeHttpRoute, mapThrownError } from "./http/pipeline";

/** Reproduces the public URL of a route: the seam path with the application's global `api` prefix prepended. */
export function withApiPrefix(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `/api${suffix}`;
}

/** The seam handler for one spec: run the pipeline, then map a thrown error into the `ErrorFilter`'s response shape. */
function routeHandler(spec: HttpRouteSpec): HttpHandler {
  return async (request, response) => {
    try {
      await executeHttpRoute(spec, { request, response });
    } catch (error) {
      const mapped = mapThrownError(error);
      response.status = mapped.status;
      response.body = mapped.body;
    }
  };
}

/**
 * The registry backing the `httpRoutes` seam. `add` records a spec, mounts it on the server immediately (returning a
 * disposer that removes both), and `list` reports the mounted specs in registration order.
 */
export class HttpRouteRegistryService implements HttpRouteRegistry {
  private readonly routes: HttpRouteSpec[] = [];

  constructor(private readonly mount: (spec: HttpRouteSpec) => HttpDisposer) {}

  add(route: HttpRouteSpec): HttpDisposer {
    this.routes.push(route);

    let unmount: HttpDisposer;
    try {
      unmount = this.mount(route);
    } catch (error) {
      this.routes.pop();
      throw error;
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.routes.indexOf(route);
      if (index >= 0) this.routes.splice(index, 1);
      unmount();
    };
  }

  list(): HttpRouteSpec[] {
    return [...this.routes];
  }
}

/**
 * Provides the `httpRoutes` registry and mounts its routes on the `http` seam.
 *
 * The plugin both provides and consumes {@link HTTP_ROUTES}. It cannot declare it in `inject.required`: the kernel
 * gates activation on required services (see `@libreoj/plugin-core`'s `Fiber.missingRequired`), so a plugin that
 * requires a service it provides would never activate. It requires `HTTP` instead, which also guarantees the server
 * exists before `apply` runs.
 */
export const httpRoutesPlugin: PluginDefinition = {
  name: "@libreoj/backend-http-routes",
  provide: [HTTP_ROUTES],
  inject: { required: [HTTP] },
  apply(ctx) {
    const server = ctx.get<HttpServer>(HTTP);
    // Seam routes bypass Nest's middleware pipeline, so the session has to be resolved here before any route runs.
    // The middleware is registered once and tolerates there being zero routes.
    server.use(createSeamAuthMiddleware());
    ctx.set(
      HTTP_ROUTES,
      new HttpRouteRegistryService(spec => server.route(spec.method, withApiPrefix(spec.path), routeHandler(spec)))
    );
  }
};
