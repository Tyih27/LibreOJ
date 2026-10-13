import type { PluginDefinition } from "@libreoj/plugin-core";

import { BACKEND_DOMAIN_MODULES, type BackendDomainModules } from "./seam";

/**
 * The registry backing {@link BackendDomainModules}. It is a plain insertion-ordered set: `add` records a module and
 * returns a remover, which a domain plugin registers through `ctx.effect` so the module is dropped when the plugin is
 * disposed (and registered again if it is reactivated).
 */
class DomainModuleRegistry implements BackendDomainModules {
  private readonly modules = new Set<unknown>();

  add(module: unknown): () => void {
    this.modules.add(module);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.modules.delete(module);
    };
  }

  list(): unknown[] {
    return [...this.modules];
  }
}

/**
 * The plugin that provides the backend's domain-module registry.
 *
 * It is listed first in the backend profile, so its `apply` runs before any domain plugin's: a domain plugin resolves
 * the registry with `getBackendDomainModules()` and contributes its Nest module with
 * `ctx.effect(() => registry.add(SomeModule))`. The `http` provider's root-module factory reads `list()` at start and
 * appends the modules to `AppModule`'s imports.
 */
export const domainModulesPlugin: PluginDefinition = {
  name: "@libreoj/backend-domain-modules",
  provide: [BACKEND_DOMAIN_MODULES],
  apply(ctx) {
    ctx.set(BACKEND_DOMAIN_MODULES, new DomainModuleRegistry());
  }
};
