import { CHECKER_REGISTRY, type CheckerRegistry } from "@libreoj/plugin-api";
import type { PluginDefinition } from "@libreoj/plugin-core";

import { customCheckerInterfaceNames, getCustomCheckerInterface } from "../checkers/custom";

/**
 * The plugin that provides the `checkerRegistry` seam. Mounting it publishes a registry backed by the judge's existing
 * custom checkers (`checkers/custom/index.ts`); the per-interface `CustomChecker` objects are not copied, they are
 * looked up through the module's internal accessor. `checkers/custom/index.ts`'s `validateCustomChecker` and
 * `runCustomChecker` resolve this same registry, so callers need not depend on the plugin directly.
 *
 * Only the `custom`-type checkers are part of this seam. The builtin checkers run through native bindings and are out
 * of scope.
 */
export const checkersPlugin: PluginDefinition = {
  name: "@libreoj/judge-checkers",
  provide: [CHECKER_REGISTRY],
  apply(ctx) {
    const registry: CheckerRegistry = {
      getCustomChecker: name => getCustomCheckerInterface(name),
      interfaces: customCheckerInterfaceNames
    };
    ctx.set(CHECKER_REGISTRY, registry);
  }
};
