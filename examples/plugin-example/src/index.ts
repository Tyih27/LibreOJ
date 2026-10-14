/**
 * Reference example for the plugin authoring docs (docs/plugins/authoring.md): a minimal but complete third-party
 * plugin package. It shows the `libreoj` manifest, the `PluginDefinition` shape, a `config` schema, and how a profile
 * overrides the effective configuration.
 */
import type { PluginDefinition } from "@libreoj/plugin-core";

/** Configuration accepted by {@link plugin}. */
export interface ExampleConfig {
  /** Greeting text published under the `exampleGreeting` service. */
  greeting?: string;
}

export const plugin: PluginDefinition<ExampleConfig> = {
  name: "libreoj-plugin-example",
  provide: ["exampleGreeting"],
  config: {
    defaults: { greeting: "hello from libreoj-plugin-example" },
    parse(input) {
      const { greeting } = input as { greeting?: unknown };
      if (greeting !== undefined && typeof greeting !== "string") {
        throw new Error("greeting must be a string");
      }
      return { greeting };
    }
  },
  apply(ctx, config) {
    ctx.provide("exampleGreeting", String(config.greeting));
  }
};
