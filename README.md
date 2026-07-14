# LibreOJ

LibreOJ is an online judge for algorithm competitions. This repository contains the complete application, judging
runtime, frontend delivery layer, and the infrastructure source required to build their artifacts.

## Repository layout

- `apps/backend`: NestJS API, persistence, queues, authentication, and WebSocket gateways.
- `apps/judge`: privileged Linux judge daemon and native checker bindings.
- `apps/bootstrap-azure`, `apps/bootstrap-cloudflare`, `apps/bootstrap-static`: first-page delivery targets.
- `packages/frontend`: versioned browser application artifact.
- `packages/simple-sandbox`: Linux namespaces and cgroup native addon used by the judge.
- `packages/judge-protocol`: compiled Backend↔Judge wire types shared by both processes.
- `packages/bootstrap-config`, `packages/bootstrap-core`, `packages/service-worker`: shared bootstrap pipeline.
- `infra/frontend-cdn`: builds the immutable frontend asset manifest.
- `infra/sandbox-rootfs`: builds the compiler root filesystem used by judge machines.
- `infra/assets`: product-owned static assets.

Each deployable remains independently addressable. The pnpm workspace provides one dependency graph and one lockfile;
it does not turn the system into a single process or deployment.

## Development

Requirements:

- Node.js 24
- pnpm 11.13.0
- Git submodules

Clone and install:

```bash
git clone --recurse-submodules https://github.com/LibreOJ/LibreOJ.git
cd LibreOJ
pnpm install --frozen-lockfile
```

Build and validate the repository:

```bash
pnpm check
```

The root scripts use pnpm's workspace dependency order. For example, a complete build produces the frontend and
service worker before generating Bootstrap configuration, then builds the Bootstrap consumers. `pnpm check-types`,
`pnpm lint`, and `pnpm check-format` remain available as focused commands; scripts that consume generated workspace
artifacts prepare those artifacts first.

Native judge components require Linux, a C++17 compiler, CMake, and `libfmt`. Build them with:

```bash
pnpm build:native
```

See the package READMEs for service-specific configuration and development commands.

## Continuous integration

The `Code` job runs `pnpm check` for pushes and pull requests targeting `main`. The `Native` job always reports a
stable status for branch protection, but its toolchain setup and builds run only when Judge, sandbox, submodule,
workspace, lockfile, or CI inputs change. Manual workflow dispatches always run the native build.

## Deployment status

Deployment is disabled. Any replacement must use supported Node runtimes and immutable third-party actions, preserve
frontend assets across long release gaps, and undergo provider-credential review.

The intended release order is: build once, upload immutable frontend assets, verify their availability, stage the
Bootstrap responses, smoke-test them, then promote both artifacts together.

## History

The component repositories were imported with their branches, tags, and open pull-request heads. Historical tags are
namespaced by component. `monorepo-import-baseline` identifies the content-preserving import before workspace
restructuring and the LibreOJ rebrand.

## License

LibreOJ is licensed under the MIT License. Package-level license files preserve the attribution of imported
components, including `simple-sandbox`.
