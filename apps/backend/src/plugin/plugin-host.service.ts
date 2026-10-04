import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { InlineResolver, PluginHost } from "@libreoj/plugin-core";
import { codeLanguagePlugin } from "@libreoj/plugin-code-language";

/** The single bundle this backend composes today; the host is built from this in-memory layer. */
const CODE_LANGUAGE_BUNDLE = "@libreoj/plugin-code-language";

/**
 * Owns the backend's one {@link PluginHost}. The kernel is created once, loaded with the official plugins through an
 * in-memory resolver, and torn down with the module -- so a future seam that bridges another service reads the same
 * kernel instead of composing a second one.
 *
 * Initialization is a single idempotent promise: whichever runs first (the registry factory, or Nest's
 * `onModuleInit`) creates and loads the host, and the other observes the same promise. This keeps the factory's
 * synchronous `get` safe without an async constructor, while `onModuleDestroy` forwards to `host.dispose()`.
 */
@Injectable()
export class PluginHostService implements OnModuleInit, OnModuleDestroy {
  private host: PluginHost | null = null;

  private initialization: Promise<void> | null = null;

  /** Creates and loads the host exactly once; concurrent callers share the same promise. */
  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.load();
    }
    return this.initialization;
  }

  private async load(): Promise<void> {
    const host = new PluginHost({
      resolver: new InlineResolver({ [CODE_LANGUAGE_BUNDLE]: codeLanguagePlugin })
    });
    this.host = host;
    try {
      await host.load([{ bundles: [CODE_LANGUAGE_BUNDLE] }]);
    } catch (error) {
      // A half-initialized host must not leak: if Nest aborts startup on a load failure it will not call
      // `onModuleDestroy`, so dispose here as well. `dispose()` is idempotent, so the teardown path is harmless.
      await host.dispose();
      this.host = null;
      throw error;
    }
  }

  /** A service provided by the kernel, resolved from the root scope. Requires {@link initialize} to have resolved. */
  get<T>(name: string): T {
    if (!this.host) throw new Error("PluginHostService has not been initialized");
    return this.host.root.get<T>(name);
  }

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.initialization) await this.initialization;
    } finally {
      // Clean up even when initialization rejected, so a failed load cannot leave the host undisposed.
      await this.host?.dispose();
      this.host = null;
    }
  }
}
