import { AsyncLocalStorage } from "async_hooks";

import { NestMiddleware, Injectable } from "@nestjs/common";

import { Request, Response } from "express"; // eslint-disable-line import/no-extraneous-dependencies

import { AuthSessionService } from "./auth-session.service";

import { UserEntity } from "../user/user.entity";
import { UserPrivilegeService, UserPrivilegeType } from "../user/user-privilege.service";

const asyncLocalStorage = new AsyncLocalStorage();

export interface Session {
  sessionKey?: string;
  sessionId?: number;
  user?: UserEntity;
  userCanSkipRecaptcha: () => Promise<boolean>;
}

export interface RequestWithSession extends Request {
  session: Session;
}

/**
 * Resolves the bearer session on `req` and assigns `req.session` when the key names a live session.
 *
 * A missing header, a header without a bearer token, or an invalid/expired key are all no-ops: the function never
 * rejects, so authentication stays advisory (a route decides for itself whether an unauthenticated request is
 * acceptable). This is the session-resolution half of {@link AuthMiddleware}, extracted so the seam-layer auth
 * middleware (which does not run through Nest's middleware pipeline) shares exactly one implementation with it.
 */
export async function resolveSession(
  req: RequestWithSession,
  authSessionService: AuthSessionService,
  userPrivilegeService: UserPrivilegeService
): Promise<void> {
  const authHeader = req.headers.authorization;
  const sessionKey = authHeader && authHeader.split(" ")[1];
  if (sessionKey) {
    const [sessionId, user] = await authSessionService.accessSession(sessionKey);
    if (user) {
      req.session = {
        sessionKey,
        sessionId,
        user,
        userCanSkipRecaptcha: () => userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.SkipRecaptcha)
      };
    }
  }
}

/**
 * Runs `fn` inside the async-local-storage context {@link getCurrentRequest} reads, so code reached from `fn` (for
 * example `AuditService`) can obtain the current request. Both the Nest middleware and the seam middleware wrap their
 * `next()` in this, so there is a single store rather than one per middleware.
 */
export function runWithCurrentRequest<T>(req: RequestWithSession, fn: () => T): T {
  return asyncLocalStorage.run(req, fn);
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly userPrivilegeService: UserPrivilegeService
  ) {}

  async use(req: RequestWithSession, res: Response, next: () => void): Promise<void> {
    await resolveSession(req, this.authSessionService, this.userPrivilegeService);
    runWithCurrentRequest(req, () => next());
  }
}

/**
 * Get the current request object from async local storage.
 *
 * Calling it in a EventEmitter's callback may be not working since EventEmitter's callbacks
 * run in different contexts.
 */
export function getCurrentRequest(): RequestWithSession {
  return asyncLocalStorage.getStore() as RequestWithSession;
}
