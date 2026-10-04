import type { PluginDefinition } from "@libreoj/plugin-core";
import { CODE_LANGUAGE_REGISTRY } from "@libreoj/plugin-api";

import { CodeLanguageRegistryService } from "./code-language.registry";

/**
 * The Cordis plugin that provides the `codeLanguageRegistry` seam. Mounting it registers the registry on the plugin
 * context, so any consumer that injects `CODE_LANGUAGE_REGISTRY` receives the validating service the backend used to
 * own directly.
 */
export const codeLanguagePlugin: PluginDefinition = {
  name: "@libreoj/plugin-code-language",
  provide: [CODE_LANGUAGE_REGISTRY],
  apply(ctx) {
    ctx.set(CODE_LANGUAGE_REGISTRY, new CodeLanguageRegistryService());
  }
};
