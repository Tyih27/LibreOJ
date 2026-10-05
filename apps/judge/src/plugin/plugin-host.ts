import type { PluginHost } from "@libreoj/plugin-core";

/**
 * Module-level accessor for the judge's single {@link PluginHost}. The entry point composes the host and registers it
 * here before loading it, so code reached during or after `host.load` (notably the `languages` seam delegation) can read
 * the same composition root without threading the host through every call site.
 */
let current: PluginHost | undefined;

export function setPluginHost(host: PluginHost): void {
  current = host;
}

export function getPluginHost(): PluginHost {
  if (!current) throw new Error("PluginHost has not been composed yet");
  return current;
}
