import { Global, Module } from "@nestjs/common";

import { CODE_LANGUAGE_REGISTRY, type CodeLanguageRegistry } from "@libreoj/plugin-api";

import { PluginHostService } from "./plugin-host.service";

/**
 * The bridge between the plugin kernel and Nest's dependency injection. It composes a plugin tree from an in-memory
 * resolver -- so no filesystem or profile configuration is involved and the backend's startup path is unchanged --
 * and exposes the kernel's services under Nest tokens.
 */
@Global()
@Module({
  providers: [
    PluginHostService,
    {
      provide: CODE_LANGUAGE_REGISTRY,
      useFactory: async (host: PluginHostService): Promise<CodeLanguageRegistry> => {
        // Ensure the shared kernel has loaded before reading from it; `initialize` is idempotent, so this coalesces
        // with `onModuleInit` when that runs later.
        await host.initialize();
        return host.get<CodeLanguageRegistry>(CODE_LANGUAGE_REGISTRY);
      },
      inject: [PluginHostService]
    }
  ],
  exports: [PluginHostService, CODE_LANGUAGE_REGISTRY]
})
export class PluginModule {}
