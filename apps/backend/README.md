# LibreOJ Backend

The Backend is LibreOJ's application server. It provides the HTTP API, OpenAPI schema, browser and Judge WebSocket
gateways, permissions, persistence, file signing, task queues, and Prometheus metrics.

## Dependencies

- MariaDB or MySQL
- Redis 5 or newer
- MinIO-compatible object storage
- SMTP when email features are enabled

## Configuration

Copy `config-example.yaml` to an untracked file and configure the database, Redis, object storage, mail transport,
security settings, and public endpoints. MinIO can use different URLs for server access, browser uploads, browser
downloads, and Judge downloads while sharing one bucket.

Create the database before starting the application:

```sql
CREATE DATABASE `libreoj` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `libreoj`.* TO 'libreoj'@'localhost' IDENTIFIED BY 'libreoj-password';
```

TypeORM schema synchronization runs during startup.

## Development

```bash
LIBREOJ_CONFIG_FILE=./config.yaml pnpm --filter @libreoj/backend dev
```

Production build and startup:

```bash
pnpm --filter @libreoj/backend build
LIBREOJ_CONFIG_FILE=./config.yaml pnpm --filter @libreoj/backend start:prod
```

The default listener is `127.0.0.1:2002`. HTTP routes use the `/api` prefix, and OpenAPI is available at `/docs` and
`/docs-json`.

Set `LIBREOJ_LOG_SQL=1` to log SQL statements. `LIBREOJ_MIGRATION_CONFIG_FILE` starts the SYZOJ 2 data importer.

## Process model

`server.clusters: null` runs one process. `server.clusters: 0` runs one worker per CPU, and a positive value selects
an explicit worker count. Redis coordinates clustered processes.
