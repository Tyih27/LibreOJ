import type { PluginDefinition } from "@libreoj/plugin-core";
import { HTTP, type HttpServer } from "@libreoj/plugin-api";

import { HttpNestServer, type HttpNestOptions } from "./server";

/**
 * Builds the `http` seam's NestJS Provider plugin.
 *
 * `options.rootModule` lets the application hand its existing Nest root module to the server; routes and middleware
 * contributed by other plugins are mounted alongside it. The server listens when the host reaches its `start` phase,
 * once every contributing plugin has registered.
 */
export function createHttpNestPlugin(options: HttpNestOptions = {}): PluginDefinition {
  return {
    name: "@libreoj/plugin-http-nest",
    provide: [HTTP],
    apply(ctx) {
      const server = new HttpNestServer(options);
      ctx.set(HTTP, server);
      ctx.effect(() => () => {
        void server.close();
      });
    },
    async start(ctx) {
      await ctx.get<HttpServer>(HTTP).listen();
    }
  };
}

/** The provider with default options: an empty root module listening on an ephemeral port. */
export const httpNestPlugin: PluginDefinition = createHttpNestPlugin();
