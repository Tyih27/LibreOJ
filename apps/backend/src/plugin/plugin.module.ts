import { Global, Module } from "@nestjs/common";

import { CODE_LANGUAGE_REGISTRY, type CodeLanguageRegistry } from "@libreoj/plugin-api";

import { getPluginHost } from "./plugin-host";
import { PluginHostService } from "./plugin-host.service";

/**
 * The bridge between the plugin kernel and Nest's dependency injection. The kernel itself is composed by `main.ts` and
 * made available through a module-level accessor; this module only re-exposes the shared host's services under Nest
 * tokens, so there is a single composition root rather than a second kernel built inside Nest.
 *
 * The registry is read synchronously from the already-loaded host: Nest is created from within `host.load` (the http
 * provider starts it), so by the time this factory runs the code-language plugin has been applied and its service is in
 * the root scope.
 */
@Global()
@Module({
  providers: [
    PluginHostService,
    {
      provide: CODE_LANGUAGE_REGISTRY,
      useFactory: (): CodeLanguageRegistry => getPluginHost().root.get<CodeLanguageRegistry>(CODE_LANGUAGE_REGISTRY)
    }
  ],
  exports: [PluginHostService, CODE_LANGUAGE_REGISTRY]
})
export class PluginModule {}
