# libreoj-plugin-example

Reference third-party plugin package for the [plugin developer guide](../../docs/plugins/README.md). It is deliberately
tiny: it registers one service, `exampleGreeting`, whose value comes from configuration.

The package is named **without** the `@libreoj/*` scope, as a real third-party plugin would be. It is marked
`private: true` only so this repository never publishes it; a published plugin would drop that flag.

## What it does

The `plugin` definition in `src/index.ts` declares `provide: ["exampleGreeting"]` and, in `apply`, publishes the
configured `greeting` value under that service via `ctx.provide("exampleGreeting", …)`. The value resolves from three
layers, lowest priority first:

1. `libreoj.config.greeting` in `package.json` — the manifest defaults;
2. the plugin's own `config.defaults`;
3. a profile `config` / `patch` override for the plugin's entry.

`config.parse` validates the merged value: a `greeting` that is present but not a string throws.

## Build

```bash
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter libreoj-plugin-example build
```

## Load it

`profile.example.yaml` in this directory is a runnable single-profile file. It addresses the plugin by the relative path
`"."` because the profile sits in the package root. A site that had installed the package would instead list it by
package name:

```yaml
plugins:
  - "libreoj-plugin-example"
```

Inspect the effective plugin tree:

```bash
node packages/plugin-core/dist/bin/dump-config.js examples/plugin-example/profile.example.yaml
```

The single entry should report `state: active`.

## `libreoj` manifest

| Field | Value | Purpose |
| --- | --- | --- |
| `libreoj.entry` | `dist/index.js` | Entry module, resolved relative to the package root. |
| `libreoj.config` | `{ "greeting": "hello from libreoj-plugin-example" }` | Lowest-priority default configuration layer. |

Manifest fields and the module export contract are described in
[distribution-format.md](../../docs/plugins/distribution-format.md).

## Validate

`libreoj-plugin-validate` (provided by `@libreoj/plugin-core`) checks a package against the distribution format:

```bash
libreoj-plugin-validate . --base-dir examples/plugin-example
```

Exit code `0` prints `ok`.

## Test

```bash
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter libreoj-plugin-example test
```

`src/index.test.ts` loads the built package through `NodeResolver` and asserts both the profile override and the
manifest/`config.defaults` fallback.
