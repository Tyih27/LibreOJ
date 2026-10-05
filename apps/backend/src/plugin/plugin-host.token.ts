/**
 * Nest injection token for the backend's single {@link PluginHost}. `main.ts` composes the host and contributes it to
 * the root module through this token, so every Nest-side bridge reads the same composition root instead of building a
 * second kernel of its own.
 */
export const PLUGIN_HOST = "libreoj.pluginHost";
