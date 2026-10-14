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

### Starting locally

Start the local dependency stack first:

```bash
docker compose -f compose.dev.yml up -d
```

This starts MariaDB on `127.0.0.1:3306`, Redis on `127.0.0.1:6379`, MinIO on `127.0.0.1:9000`, and the MinIO console
on `http://127.0.0.1:9001`. If your user cannot access the Docker socket, run the same command with `sudo`.

Then start the Backend. The frontend needs `GET /api/auth/getSessionInfo` during boot, so the browser application
will show a loading error if no Backend is available.

```bash
cp apps/backend/config-example.yaml apps/backend/config.yaml
# Edit apps/backend/config.yaml for the local database, Redis, object storage, mail, and public endpoints.
LIBREOJ_CONFIG_FILE="$PWD/apps/backend/config.yaml" pnpm --filter @libreoj/backend dev
```

The Backend listens on `http://127.0.0.1:2002` by default. API routes use the `/api` prefix, and OpenAPI is available
at `http://127.0.0.1:2002/docs`.

Then start the frontend development server:

```bash
pnpm --filter @libreoj/frontend dev --host 127.0.0.1
```

The Vite server listens on `http://127.0.0.1:3000` by default and proxies `/api` traffic to the local Backend.

Start all development targets that provide a `dev` script:

```bash
pnpm dev
```

This builds shared artifacts first, then runs matching workspace development servers in parallel. Use this only after
the Backend configuration and any provider-specific Bootstrap tools are ready.

### Local admin account

The startup commands do not seed an administrator. In the current local development database the following
administrator is available:

- Username: `admin`
- Password: `admin123`
- Email: `admin@libreoj.test`

If you are using a fresh database, create the same local administrator with:

```sql
INSERT INTO `user` (`username`, `email`, `nickname`, `bio`, `avatarInfo`, `isAdmin`, `acceptedProblemCount`, `submissionCount`, `rating`, `publicEmail`, `registrationTime`)
VALUES ('admin', 'admin@libreoj.test', 'admin', '', 'gravatar:admin@libreoj.test', 1, 0, 0, 0, 1, NOW());
SET @uid = LAST_INSERT_ID();
INSERT INTO `user_auth` (`userId`, `password`) VALUES (@uid, '$2b$10$MsgKnoS2IVBL6IXUavW4eu6wkEGurXgV.NCBh7yIn8wigvYMzIq1.');
INSERT INTO `user_information` (`userId`, `organization`, `location`, `url`, `telegram`, `qq`, `github`) VALUES (@uid, '', '', '', '', '', '');
INSERT INTO `user_preference` (`userId`, `preference`) VALUES (@uid, '{}');
```

This account is for local development only; do not use these credentials in production.

### Stopping locally

Stop a foreground development server with `Ctrl+C` in its terminal.

Stop the Docker dependency stack with:

```bash
docker compose -f compose.dev.yml down
```

If an application server was started in the background, find and stop it by port:

```bash
lsof -ti tcp:3000 | xargs -r kill
lsof -ti tcp:2002 | xargs -r kill
```

Component documentation:

- [Backend](apps/backend/README.md)
- [Judge](apps/judge/README.md)
- [Frontend](packages/frontend/README.md)
- [Bootstrap](packages/bootstrap-config/README.md)
- [Judge protocol](packages/judge-protocol/README.md)
- [simple-sandbox](packages/simple-sandbox/README.md)
- [Sandbox rootfs](infra/sandbox-rootfs/README.md)
- [Plugin authoring](docs/plugins/README.md)

## License

LibreOJ is licensed under the [MIT License](LICENSE). `simple-sandbox` includes its own MIT license and attribution.
