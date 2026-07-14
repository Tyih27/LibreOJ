# LibreOJ Judge Protocol

This package contains the compiled types that cross the Backend↔Judge Socket.IO boundary. It currently owns task
metadata and payload envelopes, submission status, omittable strings, and Judge machine system information.

Both processes depend on this package through `workspace:*`. pnpm builds workspace packages in dependency order, and
the root validation scripts explicitly generate this package before checking either consumer. Add wire-level fields
here before using them in Backend or Judge. Runtime policy, database entities, and executor-only state belong in
their respective applications rather than in this package.
