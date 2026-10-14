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

## OpenAPI generation (transitional)

`src/plugin/openapi/` turns provider-agnostic route specs (`HttpRouteSpec` from `@libreoj/plugin-api`) into an OpenAPI
3.0 document without a Nest application:

- `build-openapi-document.ts` exports `buildOpenApiDocument(routes, { title, description, version, globalPrefix?, bearerAuth? })`.
  It accumulates `components.schemas` from the DTO classes referenced by each route, emits `paths[path][method]` path
  items (parameters, request body, responses, `security`) and reproduces the document envelope. Paths include the
  global prefix, mirroring the `"api"` prefix the served document uses.
- `nest-swagger-internals.ts` is the **only** file that deep-imports `@nestjs/swagger`'s internal schema services, which
  produce the schemas from the `_OPENAPI_METADATA_FACTORY()` the swagger build plugin stamps on each DTO.

This is **transitional**: the module exists so the OpenAPI document can outlive the Nest application while the HTTP
stack is migrated to a Nest-free provider. The `@nestjs/swagger` coupling is confined to `nest-swagger-internals.ts` so
it can be replaced when NestJS is removed. `test/openapi-builder.test.ts` checks the output against
`SwaggerModule.createDocument` for the homepage routes.

### Baseline snapshot

`test/fixtures/openapi-baseline.json` is the pre-migration OpenAPI document for all twelve controllers, captured
before any controller is moved onto declarative routes. `scripts/openapi-baseline.cjs` regenerates it: it builds a
minimal Nest application from the compiled controllers, stubs their (and their enhancers') constructor dependencies
with a self-returning proxy, and serializes `SwaggerModule.createDocument` without binding a port. Run it after a
build:

```bash
pnpm --filter @libreoj/backend build
node apps/backend/scripts/openapi-baseline.cjs
```

`test/openapi-baseline.test.ts` guards the fixture's structure and its route set (93 routes across the twelve
controllers) so a dropped or added route fails loudly. Later milestones assert a migrated `buildOpenApiDocument`
matches this fixture.

## Declarative routes and the HTTP pipeline (transitional)

The NestJS-removal migration moves controllers onto provider-agnostic `HttpRouteSpec`s incrementally while Nest still
provides DI and the remaining controllers:

- `src/plugin/http/pipeline.ts` exports `executeHttpRoute(spec, { request, response })`. It validates the route's
  declared `query`/`params`/`body` DTO classes with Nest's `ValidationPipe` semantics
  (`plainToInstance` without implicit conversion, `whitelist`, `forbidNonWhitelisted`) and invokes the handler with a
  normalized request. The validated inputs become `request.body`/`query`/`params`, the session is forwarded as
  `request.session`, the provider's raw request stays available as `request.raw`, and the handler mutates the normalized
  `response`. `mapThrownError` turns a thrown error into the same `{ status, body }` the inbound `ErrorFilter` emits.
  It is provider-neutral: it depends only on the `http` seam, so the `http-fastify` provider reuses it unchanged.
- `src/plugin/http-routes.plugin.ts` is the `@libreoj/backend-http-routes` bundle. It provides the `httpRoutes`
  registry (the extension point domain plugins contribute specs to) and mounts each spec on the `http` seam at
  `/api<path>`, since the seam's raw `app.use(router)` mounting is not affected by Nest's `setGlobalPrefix("api")`.
  Routes are mounted as specs are added, because the `http-nest` provider freezes its router during its own `start`.

The pipeline does **not** perform authentication: it only forwards whatever session the provider's request pipeline
populated. Note that with the current `http-nest` provider a Nest middleware such as `AuthMiddleware` is registered
during `init()` (which runs when the port is bound), i.e. after the plugin router is mounted, so a migrated route does
not currently observe `req.session`. Wiring auth for migrated routes is part of the controller migration.

