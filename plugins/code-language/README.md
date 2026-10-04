# @libreoj/plugin-code-language

Provider of the `codeLanguageRegistry` seam.

This plugin registers a `CodeLanguageRegistry` implementation under the `CODE_LANGUAGE_REGISTRY` service name. The
implementation validates a request's per-language `compileAndRunOptions` with `class-validator`, using one option class
per language, and returns the same `ValidationError`-shaped failures the backend previously produced directly.

The backend consumes the registry through `@libreoj/plugin-api` (the seam vocabulary) and no longer depends on this
package's implementation details. Mounting happens in `apps/backend/src/plugin/plugin-host.service.ts`.
