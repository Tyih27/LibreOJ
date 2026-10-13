import type { PluginDefinition } from "@libreoj/plugin-core";

import { BACKEND_DOMAIN_MODULES, type BackendDomainModules } from "../seam";

/**
 * Builds the plugin that contributes a domain's Nest module to the application root.
 *
 * Every domain plugin does the same thing: require the {@link BACKEND_DOMAIN_MODULES} registry (provided by
 * `@libreoj/backend-domain-modules`, which is listed first in the backend profile so the registry is available for
 * `inject.required`), resolve it in `apply`, and add its module through `ctx.effect`. `name` is the bundle name the
 * backend profile lists; `module` is the domain's Nest module, whose own imports keep its providers resolving inside
 * the same Nest root module graph.
 *
 * The registration is reversible in the kernel, but the Nest root module is built **once**, when the `http` provider
 * starts, so removing an entry afterwards does not unregister the module from the running application. A domain is
 * added or removed by editing the profile and restarting -- the startup-time composition the design calls for; there is
 * deliberately no runtime hot-plugging.
 */
export function defineDomainPlugin(name: string, module: unknown): PluginDefinition {
  return {
    name,
    inject: { required: [BACKEND_DOMAIN_MODULES] },
    apply(ctx) {
      const modules = ctx.get<BackendDomainModules>(BACKEND_DOMAIN_MODULES);
      ctx.effect(() => modules.add(module));
    }
  };
}
