import type { PluginHost } from "@libreoj/plugin-core";

/**
 * Module-level accessor for the backend's single {@link PluginHost}. `main.ts` composes the host and registers it here
 * before loading it, so Nest-side bridges created during application startup (inside `host.load`) can read the same
 * composition root without disturbing the Nest module graph.
 */
let current: PluginHost | undefined;

export function setPluginHost(host: PluginHost): void {
  current = host;
}

export function getPluginHost(): PluginHost {
  if (!current) throw new Error("PluginHost has not been composed yet");
  return current;
}
