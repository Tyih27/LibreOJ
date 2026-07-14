# Repository instructions

## Product terminology

- The product name is **LibreOJ**. Do not introduce `Lyrio`, `lyrio-dev`, `@lyrio/*`, or `syzoj_ng` names.
- Runtime environment variables use the `LIBREOJ_` prefix.
- Example credentials use unmistakable placeholders such as `YOUR_GITHUB_TOKEN` and `YOUR_JUDGE_CLIENT_KEY`.

## Workspace boundaries

| Path | Responsibility |
| --- | --- |
| `apps/backend` | HTTP API, WebSockets, persistence, queues, authentication, and application policy |
| `apps/judge` | Judge daemon, task execution, checker bindings, and rootfs integration |
| `apps/bootstrap-*` | Provider-specific Bootstrap entry points |
| `packages/frontend` | Browser application artifact |
| `packages/judge-protocol` | Types that cross the Backend–Judge Socket.IO boundary |
| `packages/simple-sandbox` | Linux namespaces and cgroup native addon |
| `packages/bootstrap-config` | Generated regional HTML and service-worker responses |
| `packages/bootstrap-core` | Provider-independent Bootstrap request handling |
| `packages/service-worker` | Service worker and installer artifacts |
| `infra/frontend-cdn` | Frontend CDN directory and integrity manifest |
| `infra/sandbox-rootfs` | Compiler rootfs recipe |
| `infra/assets` | Product-owned static assets |

Do not move runtime policy or database entities into `packages/judge-protocol`. Do not duplicate wire types in Backend
or Judge.

## Toolchain and commands

- Use Node.js 24, pnpm 11.13.0, and the root `pnpm-lock.yaml`.
- Use `workspace:*` for internal JavaScript package dependencies.
- Use pnpm workspace commands directly. Do not add Yarn, npm lockfiles, Turborepo, or another task runner.
- CI installations use `pnpm install --frozen-lockfile`.

Primary commands:

```bash
pnpm check
pnpm build
pnpm check-types
pnpm lint
pnpm check-format
pnpm build:native
```

`pnpm --recursive --sort` orders packages by workspace dependencies. Cross-task artifact prerequisites are expressed
by the root `build:artifacts` script.

## Generated artifacts

The build pipeline is:

```text
frontend + service-worker -> bootstrap-config -> bootstrap-core -> Bootstrap targets
frontend -> frontend-cdn
judge-protocol -> Backend + Judge
simple-sandbox -> Judge
```

Generated files are ignored and must not be committed:

- package `dist`, `lib`, and native `build` directories
- `packages/bootstrap-config/config.json`
- `packages/frontend/stats.html`
- ESLint caches

When adding an artifact consumer, declare the producer as a workspace dependency and update `build:artifacts` only
when pnpm cannot express the required cross-task edge.

## Native code

Native builds require Linux, CMake, Ninja or Make, a C++17 compiler, Node.js headers, and `libfmt`. Initialize
`apps/judge/vendor/testlib` before building.

Use Ubuntu 24.04 with GCC 13 and Ninja as the compatibility baseline:

```bash
git submodule update --init --recursive
pnpm build:native
```

Native changes must compile both `packages/simple-sandbox` and `apps/judge` without project-owned warnings.

## Continuous integration

`.github/workflows/ci.yml` exposes stable `Code` and `Native` job names. `Code` runs the complete pnpm validation.
`Native` always reports a status, but its setup and compilation steps run only when native, submodule, workspace,
lockfile, or workflow inputs change. Keep its path list synchronized with native build inputs.

There is no deployment workflow. Do not add automatic deployment without an explicit credential review and an
artifact promotion design. A release must build the frontend once, upload immutable assets, verify them, stage all
Bootstrap targets, smoke-test them, and then promote the matching artifacts.

## Documentation

- Human-facing READMEs describe the product or component as it exists and how to use it.
- Maintenance rules, repository invariants, CI behavior, and release constraints belong in `AGENTS.md`.
- Do not describe implementation history or migration operations in current-state documentation.
- Rewrite an affected document as a coherent whole and update every related document in the same change.

## Validation

Run the checks appropriate to every changed area:

| Change | Required validation |
| --- | --- |
| JavaScript/TypeScript, manifests, or lockfile | `pnpm check` and `pnpm install --frozen-lockfile` |
| Native code or CMake | `pnpm build:native` on Ubuntu 24.04 |
| Workflow YAML | `actionlint .github/workflows/ci.yml` |
| Package dependency policy | `pnpm peers check --lockfile-only` |
| Secrets, examples, or configuration | `gitleaks detect --source . --no-git` |
