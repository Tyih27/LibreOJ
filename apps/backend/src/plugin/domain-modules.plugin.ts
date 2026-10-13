import type { PluginDefinition } from "@libreoj/plugin-core";

import { BACKEND_DOMAIN_MODULES, type BackendDomainModules } from "./seam";

/**
 * The registry backing {@link BackendDomainModules}. It is a plain insertion-ordered set: `add` records a module and
 * returns a remover, which a domain plugin registers through `ctx.effect` so the kernel's bookkeeping stays consistent
 * when that plugin is disposed. The `http` provider reads `list()` exactly once, when it creates the Nest application,
 * so a later disposal does not remove the module from the running application (see `defineDomainPlugin`).
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
 * `ctx.effect(() => registry.add(SomeModule))`. The `http` provider's root-module factory reads `list()` once, when it
 * creates the application, and appends the modules to `AppModule`'s imports.
 */
export const domainModulesPlugin: PluginDefinition = {
  name: "@libreoj/backend-domain-modules",
  provide: [BACKEND_DOMAIN_MODULES],
  apply(ctx) {
    ctx.set(BACKEND_DOMAIN_MODULES, new DomainModuleRegistry());
  }
};
