import { Injectable, type OnModuleDestroy } from "@nestjs/common";

import { getPluginHost } from "./plugin-host";

/**
 * The Nest-side bridge to the backend's single {@link PluginHost}. The host is composed by `main.ts` and registered
 * with the module-level accessor before it is loaded; this service never builds or loads a kernel of its own -- it only
 * exposes the shared root scope's services under Nest tokens and forwards teardown to the composition root.
 *
 * Because the host has already been loaded when Nest creates the application (the http provider starts Nest from inside
 * `host.load`), the root scope is fully populated by the time any factory here runs, so {@link get} is synchronous.
 */
@Injectable()
export class PluginHostService implements OnModuleDestroy {
  /** A service provided by the kernel, resolved from the shared host's root scope. */
  get<T>(name: string): T {
    return getPluginHost().root.get<T>(name);
  }

  /** Tears down the shared host. `PluginHost.dispose()` is idempotent, so a repeated call is harmless. */
  async onModuleDestroy(): Promise<void> {
    await getPluginHost().dispose();
  }
}
