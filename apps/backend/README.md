# LibreOJ Backend

The backend is LibreOJ's control plane. It provides the HTTP API, OpenAPI schema, browser and judge WebSocket
gateways, task queue, permissions, persistence, file signing, and optional Prometheus metrics.

## Services

The application requires:

- MariaDB or MySQL
- Redis 5 or newer
- MinIO-compatible object storage
- an SMTP transport when email features are enabled

Copy `config-example.yaml` to an untracked configuration file and update every credential and endpoint. The MinIO
configuration may expose different URLs for server access, user upload, user download, and judge download while
using one bucket.

Create the initial database explicitly; TypeORM currently synchronizes the schema at startup:

```sql
CREATE DATABASE `libreoj` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `libreoj`.* TO 'libreoj'@'localhost' IDENTIFIED BY 'libreoj-password';
```

## Run

```bash
LIBREOJ_CONFIG_FILE=./config.yaml pnpm --filter @libreoj/backend dev
```

Production builds and startup:

```bash
pnpm --filter @libreoj/backend build
LIBREOJ_CONFIG_FILE=./config.yaml pnpm --filter @libreoj/backend start:prod
```

Set `LIBREOJ_LOG_SQL=1` to log SQL. Set `LIBREOJ_MIGRATION_CONFIG_FILE` only when running the one-shot SYZOJ 2 data
migration; it is unrelated to normal schema migrations.

The default API prefix is `/api`; OpenAPI is served at `/docs` and `/docs-json`. The default listener is
`127.0.0.1:2002`.

`server.clusters: null` disables Node clustering. `server.clusters: 0` enables one worker per CPU; a positive value
selects an explicit worker count. Redis is required for coordination between those processes.
