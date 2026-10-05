import { LANGUAGE_REGISTRY, type LanguageRegistry } from "@libreoj/plugin-api";
import type { PluginDefinition } from "@libreoj/plugin-core";

import { getLanguageConfig, getLanguageNames } from "../languages";

/**
 * The plugin that provides the `languageRegistry` seam. Mounting it publishes a registry backed by the judge's existing
 * language loading (`languages/index.ts`); the per-language definitions are not copied, they are looked up through the
 * module's internal accessor. `languages/index.ts`'s `getLanguage` resolves this same registry, so callers need not
 * depend on the plugin directly.
 */
export const languagesPlugin: PluginDefinition = {
  name: "@libreoj/judge-languages",
  provide: [LANGUAGE_REGISTRY],
  apply(ctx) {
    const registry: LanguageRegistry = {
      getLanguage: name => getLanguageConfig(name),
      names: getLanguageNames()
    };
    ctx.set(LANGUAGE_REGISTRY, registry);
  }
};
