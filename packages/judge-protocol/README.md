# LibreOJ Judge Protocol

`@libreoj/judge-protocol` defines the values exchanged between the Backend and Judge over Socket.IO:

- task metadata and payload envelopes
- task types
- submission status
- omittable testcase output
- Judge machine system information

Both applications depend on the compiled package through `workspace:*`.

```bash
pnpm --filter @libreoj/judge-protocol build
pnpm --filter @libreoj/judge-protocol check-types
```

The build writes JavaScript declarations and source maps to `dist`.
