/**
 * The seam-layer authentication middleware.
 *
 * Migrated `HttpRouteSpec` routes are mounted on the `http` seam with raw `app.use(router)`, which happens before Nest
 * calls `init()`. Nest binds its middleware (including `AuthMiddleware`) during `init()`, i.e. when the port is bound,
 * so a seam route never runs through `AuthMiddleware` and `request.raw.session` would otherwise stay `undefined`. This
 * middleware fills that gap: it reproduces `AuthMiddleware`'s session resolution on the seam, using the shared
 * {@link resolveSession}, and runs the rest of the pipeline inside the shared async-local-storage context so
 * `AuditService.getCurrentRequest()` keeps working.
 *
 * Like `AuthMiddleware` it is advisory: it never rejects a request. It is registered once, on the `http` seam, in
 * `http-routes.plugin.ts`'s `apply`, before any route is mounted.
 */

import type { HttpMiddleware } from "@libreoj/plugin-api";

import { resolveSession, runWithCurrentRequest, type RequestWithSession } from "../../auth/auth.middleware";
import { svc } from "../../service-resolver";

/** Builds the seam auth middleware. The services are resolved per request, so no instance is held at registration. */
export function createSeamAuthMiddleware(): HttpMiddleware {
  return async (request, _response, next) => {
    const raw = request.raw as RequestWithSession | undefined;
    if (!raw) {
      await next();
      return;
    }

    await resolveSession(raw, svc("authSessionService"), svc("userPrivilegeService"));
    await runWithCurrentRequest(raw, () => next());
  };
}
