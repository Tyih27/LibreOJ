# LibreOJ Bootstrap

Bootstrap serves the initial LibreOJ HTML document and service worker. It selects regional API, asset, avatar, and
CDN endpoints without rebuilding the browser application.

```text
@libreoj/frontend ─────────┐
@libreoj/service-worker ──┴─> @libreoj/bootstrap-config
                                  ↓
                         @libreoj/bootstrap-core
                          ↙        ↓        ↘
                     Azure    Cloudflare   static
```

`@libreoj/bootstrap-config` reads `settings.json`, the Frontend build, and the Service Worker build. It writes
`config.json` with regional HTML responses, the service worker response, and build metadata.

`@libreoj/bootstrap-core` maps an incoming request and client region to the appropriate response. The Azure,
Cloudflare, and static applications provide platform-specific entry points.

## Build

```bash
pnpm --filter '@libreoj/bootstrap-cloudflare...' --sort run build
pnpm --filter '@libreoj/bootstrap-azure...' --sort run build
```
