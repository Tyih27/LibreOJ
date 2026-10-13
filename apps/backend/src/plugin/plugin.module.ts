import { Global, Module } from "@nestjs/common";

import { CODE_LANGUAGE_REGISTRY, type CodeLanguageRegistry } from "@libreoj/plugin-api";

import { getPluginHost } from "./plugin-host";
import { PluginHostService } from "./plugin-host.service";
import { PROBLEM_TYPE_REGISTRY, type ProblemTypeRegistry } from "./seam";

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
    },
    {
      // Required: `ProblemTypeFactoryService` injects this token, and the remaining (un-migrated) problem and submission
      // modules depend on that adapter, so disabling the `@libreoj/backend-problem-type-registry` bundle aborts boot
      // rather than degrading. It is a capability seam, not an optional one.
      provide: PROBLEM_TYPE_REGISTRY,
      useFactory: (): ProblemTypeRegistry => getPluginHost().root.get<ProblemTypeRegistry>(PROBLEM_TYPE_REGISTRY)
    }
  ],
  exports: [PluginHostService, CODE_LANGUAGE_REGISTRY, PROBLEM_TYPE_REGISTRY]
})
export class PluginModule {}
