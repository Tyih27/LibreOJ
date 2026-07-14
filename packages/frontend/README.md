# LibreOJ Frontend

`@libreoj/frontend` builds the browser application and publishes `dist` as an immutable artifact. Bootstrap consumes
the generated `index.html`; JavaScript, CSS, fonts, and WebAssembly files are delivered separately as content-hashed
assets.

The HTML intentionally contains placeholders such as `__api_endpoint__`, `__public_path__`, and `__favicon__`.
Bootstrap replaces them for each region without rebuilding the frontend. Large browser dependencies are also loaded
from configurable CDN endpoints.

## Development

Start Vite:

```bash
pnpm --filter @libreoj/frontend dev
```

The unmodified development HTML uses same-origin defaults. When the API is on another origin, serve the frontend
behind a local reverse proxy that substitutes the API placeholder and forwards WebSocket traffic.

Build and type-check:

```bash
pnpm --filter @libreoj/frontend build
pnpm --filter @libreoj/frontend check-types
```

API declarations under `src/api-generated` are generated from the backend OpenAPI document:

```bash
API_HOST=http://api.libreoj.test pnpm --filter @libreoj/frontend generate-api
```

Generated code is committed so API changes remain reviewable. Regeneration requires a running backend whose schema
matches the proposed change.

Seven pnpm patches preserve legacy-browser detection, dynamic public paths, and small upstream compatibility fixes.
Their package versions are intentionally pinned; update a patch and its evidence together when upgrading.
