# LibreOJ Bootstrap

Bootstrap serves LibreOJ's first HTML response and service worker while the frontend's content-hashed assets remain
on the static CDN.

The workspace graph is:

```text
@libreoj/frontend ─────────┐
@libreoj/service-worker ──┴─> @libreoj/bootstrap-config
                                  ↓
                         @libreoj/bootstrap-core
                          ↙        ↓        ↘
                     Azure    Cloudflare   static
```

`@libreoj/bootstrap-config` reads the locally built frontend artifact, injects the service-worker installer,
materializes regional substitutions from `settings.json`, minifies inline non-module scripts, and emits a generated
`config.json`. The output is deterministic for a Git commit: build metadata uses the commit SHA and commit time.

Build a target and all its workspace dependencies with pnpm's dependency filter:

```bash
pnpm --filter '@libreoj/bootstrap-cloudflare...' --sort run build
pnpm --filter '@libreoj/bootstrap-azure...' --sort run build
```

Deployment is intentionally not configured. Provider-specific promotion must consume the frontend and Bootstrap
artifacts from the same verified build.
