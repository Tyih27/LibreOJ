import type { PluginDefinition } from "@libreoj/plugin-core";

import { BACKEND_DOMAIN_MODULES, type BackendDomainModules } from "../seam";

import { HomepageModule } from "../../homepage/homepage.module";

/**
 * The plugin that contributes the homepage domain's Nest module to the application root.
 *
 * It is listed after `@libreoj/backend-domain-modules` in the backend profile, so the registry is available for
 * `inject.required`; `apply` then resolves it and adds {@link HomepageModule} through `ctx.effect`, which removes the
 * module again when the plugin is disposed. The module keeps its own imports, so the domain's providers still resolve
 * inside the same Nest root module graph.
 */
export const homepagePlugin: PluginDefinition = {
  name: "@libreoj/backend-domain-homepage",
  inject: { required: [BACKEND_DOMAIN_MODULES] },
  apply(ctx) {
    const modules = ctx.get<BackendDomainModules>(BACKEND_DOMAIN_MODULES);
    ctx.effect(() => modules.add(HomepageModule));
  }
};
