import type { PluginDefinition } from "@libreoj/plugin-core";
import { HTTP, type HttpServer } from "@libreoj/plugin-api";

import { HttpNestServer, type HttpNestOptions } from "./server";

/**
 * Builds the `http` seam's NestJS Provider plugin.
 *
 * `options.rootModule` (or `options.rootModuleFactory`, when the module is only known once the composition root has
 * loaded) is the application's Nest root module and `options.nest` its Nest runtime; passing the runtime
 * in keeps one `@nestjs/core` instance in the process. Routes and middleware contributed by other plugins are mounted
 * alongside the root module's controllers. The server listens when the host reaches its `start` phase, once every
 * contributing plugin has registered; with `options.listen === false` it only creates and configures the application,
 * leaving the caller to bind later.
 */
export function createHttpNestPlugin(options: HttpNestOptions): PluginDefinition {
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
      const server = ctx.get<HttpServer>(HTTP);
      if (options.listen === false) await (server as HttpNestServer).prepare();
      else await server.listen();
    }
  };
}
