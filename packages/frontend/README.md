# LibreOJ Frontend

The Frontend is LibreOJ's browser application. Its production build writes `dist`, containing an HTML entry point
and content-hashed JavaScript, CSS, font, image, and WebAssembly assets.

Bootstrap replaces placeholders in the HTML entry point for API, asset, avatar, favicon, title, and CDN endpoints.
The hashed assets do not require region-specific builds.

## Development

Start Vite:

```bash
pnpm --filter @libreoj/frontend dev
```

The development HTML uses same-origin defaults. A local reverse proxy can substitute the API endpoint and forward
WebSocket traffic when the Backend runs on another origin.

Build and type-check:

```bash
pnpm --filter @libreoj/frontend build
pnpm --filter @libreoj/frontend check-types
```

## API declarations

Generate TypeScript declarations from a running Backend's OpenAPI document:

```bash
API_HOST=http://api.libreoj.test pnpm --filter @libreoj/frontend generate-api
```

The generated modules are written to `src/api-generated`.
