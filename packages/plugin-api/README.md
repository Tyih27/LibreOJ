# @libreoj/plugin-api

`@libreoj/plugin-api` holds the **Service Definition** half of every plugin seam: the interfaces a Service Provider
implements and a Consumer depends on. It is a leaf package — it imports nothing from `apps/*` or other workspace
packages — so backend, judge, and build-time frontend code can share one contract without pulling in each other's
implementation.

Wire types exchanged across the Backend–Judge boundary stay in `@libreoj/judge-protocol`; this package is for
in-process service contracts only.

## Conventions

- **Service name constant** — SCREAMING_SNAKE_CASE const whose value is the camelCase name the service registers under
  on a plugin context (e.g. `CODE_LANGUAGE_REGISTRY = "codeLanguageRegistry"`).
- **Registry interface** — one `<Domain>Registry` interface per seam, with the exact method names and shapes of the
  current implementation. It is re-declared here, never imported from `apps/*`.
- **Domain types** — value sets shared by a seam are exported as a string `enum` (e.g. `CodeLanguage`) so the values
  stay enumerable at runtime (`Object.values`) while callers keep the original backend declaration member-for-member.

## Seams

| Seam | Constant | Interface | Source mirrored |
| --- | --- | --- | --- |
| Code language | `CODE_LANGUAGE_REGISTRY` | `CodeLanguageRegistry` | `apps/backend/src/code-language/` |
| Judge language | `LANGUAGE_REGISTRY` | `LanguageRegistry` | `apps/judge/src/languages/index.ts` |

Other seams (`http`, `database`, `cache`, `storage`, `mail`, …) are added only when an implementation needs them.

### Judge language seam

`LANGUAGE_REGISTRY` (`"languageRegistry"`) mirrors the judge's language lookup. `LanguageRegistry.getLanguage(name)`
returns a `LanguageConfig` and the provider is expected to throw on an unknown name; `names` exposes the supported
language names. `LanguageConfig<T>` keeps the judge's `name` / `getMetaOptions` / `compile` / `run` members, and the
sandbox and POSIX types those members reference (`TaskIndependentSandboxConfig`, `SandboxConfigBase`,
`CompilationConfig`, `FileDescriptor`, `OverridableRecord`) are re-declared here as structurally equivalent
interfaces. Judge-only concerns (checker bindings, sandbox RPC, …) stay out of this seam.

## Scripts

```bash
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter @libreoj/plugin-api build
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter @libreoj/plugin-api check-types
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter @libreoj/plugin-api test
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter @libreoj/plugin-api check-format
```

`build` emits declarations and source maps to `dist`; `test` runs the `node:test` suites through `tsx`.
