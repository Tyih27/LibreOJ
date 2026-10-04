import { test } from "node:test";
import * as assert from "node:assert/strict";
import { normalizePlugin } from "./index";
import type { Context, PluginConfigSchema, PluginDefinition, PluginFunction } from "./index";

test("normalizePlugin lifts a function plugin's static fields onto a definition", () => {
  const config: PluginConfigSchema<Record<string, unknown>> = { defaults: { port: 80 } };
  const start = (): void => {};

  function database(ctx: Context, _config: Record<string, unknown>): void {
    ctx.set("database", {});
  }
  const plugin = Object.assign(database, {
    inject: { required: ["config"] },
    provide: ["database"],
    Config: config,
    start
  });

  const definition = normalizePlugin(plugin);

  assert.equal(definition.name, "database");
  assert.equal(definition.apply, plugin);
  assert.equal(definition.start, start);
  assert.equal(definition.config, config);
  assert.deepEqual(definition.inject, { required: ["config"] });
  assert.deepEqual(definition.provide, ["database"]);
});

test("normalizePlugin uses the fallback name when the function is anonymous", () => {
  const anonymous: PluginFunction = () => {};
  Object.defineProperty(anonymous, "name", { value: "" });

  assert.equal(normalizePlugin(anonymous, "fallback").name, "fallback");
});

test("normalizePlugin rejects a function with no name and no fallback", () => {
  const anonymous: PluginFunction = () => {};
  Object.defineProperty(anonymous, "name", { value: "" });

  assert.throws(() => normalizePlugin(anonymous), /name/);
});

test("normalizePlugin returns an object definition unchanged and validates its name", () => {
  const definition: PluginDefinition = { name: "object-plugin", apply: () => {} };
  assert.equal(normalizePlugin(definition), definition);

  const unnamed = { name: "" } as PluginDefinition;
  assert.throws(() => normalizePlugin(unnamed), /name/);
});
