# LibreOJ

LibreOJ is an online judge for algorithm competitions. It provides problem management, submissions, discussions,
user and group administration, distributed judging, and a browser-based interface. The public instance is available
at [loj.ac](https://loj.ac/).

This repository contains the web application, judge runtime, delivery services, and supporting infrastructure.

## Architecture

- The Backend exposes the HTTP and WebSocket APIs and coordinates persistence, files, queues, and judge machines.
- The Frontend is a browser application whose content-hashed assets are served through the frontend CDN.
- Bootstrap selects regional endpoints and serves the initial HTML document and service worker.
- Judge machines compile and execute submissions inside the Linux `simple-sandbox` runtime and compiler rootfs.

## Source layout

- `apps/backend`: API and application services.
- `apps/judge`: distributed judge daemon and native checker bindings.
- `apps/bootstrap-*`: Azure, Cloudflare, and static Bootstrap targets.
- `packages/frontend`: browser application.
- `packages/judge-protocol`: Backend–Judge wire types.
- `packages/simple-sandbox`: Linux process sandbox.
- `packages/bootstrap-*` and `packages/service-worker`: shared Bootstrap implementation.
- `infra/frontend-cdn`, `infra/sandbox-rootfs`, and `infra/assets`: delivery and judge infrastructure.

## Development

Requirements:

- Node.js 24
- pnpm 11.13.0
- Git submodules

```bash
git clone --recurse-submodules https://github.com/LibreOJ/LibreOJ.git
cd LibreOJ
pnpm install --frozen-lockfile
pnpm check
```

Component documentation:

- [Backend](apps/backend/README.md)
- [Judge](apps/judge/README.md)
- [Frontend](packages/frontend/README.md)
- [Bootstrap](packages/bootstrap-config/README.md)
- [Judge protocol](packages/judge-protocol/README.md)
- [simple-sandbox](packages/simple-sandbox/README.md)
- [Sandbox rootfs](infra/sandbox-rootfs/README.md)

## License

LibreOJ is licensed under the [MIT License](LICENSE). `simple-sandbox` includes its own MIT license and attribution.
