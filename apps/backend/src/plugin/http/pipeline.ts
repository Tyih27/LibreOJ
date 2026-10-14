/**
 * The provider-neutral execution pipeline for declarative routes.
 *
 * A {@link HttpRouteSpec} states the contract its handler expects (the DTO classes for query, path and body) but mounts
 * through the low-level `http` seam, whose {@link HttpHandler} only receives a normalized request/response. This module
 * bridges the two: it turns the raw request payloads into validated DTO instances, forwards the application session,
 * and invokes the handler. Any HTTP provider (today `http-nest`, in `M7.final` `http-fastify`) mounts routes through
 * the same seam, so this semantics lives here once instead of in each provider.
 *
 * It reproduces Nest's `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })`:
 * `plainToInstance` without implicit conversion, then `class-validator` with `whitelist` and `forbidNonWhitelisted`,
 * and a flattened error list identical to Nest's `flattenValidationErrors` (so an `ErrorFilter`-shaped
 * `{ statusCode: 400, message: string[], error: "Bad Request" }` is produced).
 */

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import type { HttpRequest, HttpResponse, HttpRouteSpec } from "@libreoj/plugin-api";

import type { RequestWithSession, Session } from "../../auth/auth.middleware";

/** Options for {@link validateDto}, mirroring the global `ValidationPipe` configuration. */
export interface ValidateDtoOptions {
  /** Remove properties that have no validation decorator. Defaults to `true`. */
  whitelist?: boolean;
  /**
   * Instead of silently removing non-whitelisted properties, reject the request when any is present. Defaults to
   * `true`, matching the backend's global pipe.
   */
  forbidNonWhitelisted?: boolean;
}

const DEFAULT_VALIDATE_OPTIONS: Required<ValidateDtoOptions> = { whitelist: true, forbidNonWhitelisted: true };

/** The structural view of a `class-validator` error needed to reproduce Nest's flattening. */
export interface ValidationErrorLike {
  property: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorLike[];
}

/**
 * A thrown HTTP error carrying the status and body the inbound `ErrorFilter` would have sent. It is duck-typed to be
 * compatible with Nest's `HttpException` (`getStatus`/`getResponse`), so {@link mapThrownError} maps it and any real
 * `HttpException` a migrated handler throws through the same path -- without this module importing Nest.
 */
export class HttpError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(typeof body === "string" ? body : JSON.stringify(body));
    this.name = "HttpError";
  }

  getStatus(): number {
    return this.status;
  }

  getResponse(): unknown {
    return this.body;
  }
}

/** Prefixes every constraint message with the parent property path, exactly as Nest's `prependConstraintsWithParentProp`. */
function prependConstraints(parentPath: string, error: ValidationErrorLike): ValidationErrorLike {
  const constraints: Record<string, string> = {};
  for (const key of Object.keys(error.constraints ?? {})) {
    constraints[key] = `${parentPath}.${error.constraints?.[key]}`;
  }
  return { ...error, constraints };
}

/**
 * Reproduces Nest's `ValidationPipe.flattenValidationErrors`: each error with children is replaced by its children
 * (constraint strings prefixed with the dotted property path), and only entries carrying `constraints` contribute.
 */
export function flattenValidationErrors(validationErrors: ValidationErrorLike[]): string[] {
  const collected: ValidationErrorLike[] = [];

  const visit = (error: ValidationErrorLike, parentPath?: string): void => {
    if (!error.children || error.children.length === 0) {
      collected.push(error);
      return;
    }

    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    for (const child of error.children) {
      if (child.children && child.children.length) visit(child, path);
      collected.push(prependConstraints(path, child));
    }
  };

  for (const error of validationErrors) visit(error);

  return collected.filter(item => !!item.constraints).flatMap(item => Object.values(item.constraints ?? {}));
}

/**
 * Transforms `value` into an instance of `modelClass` and validates it with `class-validator`.
 *
 * A non-class `modelClass` (including `undefined`, when a route declares no DTO for that input) short-circuits and
 * returns `value` unchanged, so callers can pass every declared input class without branching. `null`/`undefined`
 * values become `{}` before transformation, matching the pipe's `toEmptyIfNil` (a required field then reports a
 * validation error instead of crashing). On failure it throws an {@link HttpError} with Nest's flattened 400 body.
 */
export async function validateDto<T = unknown>(
  modelClass: unknown,
  value: unknown,
  options: ValidateDtoOptions = {}
): Promise<T> {
  if (typeof modelClass !== "function") return value as T;

  const instance = plainToInstance(modelClass as never, value ?? {}, {
    enableImplicitConversion: false
  }) as object;

  const errors = await validate(instance, {
    whitelist: options.whitelist ?? DEFAULT_VALIDATE_OPTIONS.whitelist,
    forbidNonWhitelisted: options.forbidNonWhitelisted ?? DEFAULT_VALIDATE_OPTIONS.forbidNonWhitelisted
  });

  if (errors.length > 0) {
    throw new HttpError(400, {
      statusCode: 400,
      message: flattenValidationErrors(errors),
      error: "Bad Request"
    });
  }

  return instance as unknown as T;
}

/**
 * The request a route handler receives: the provider-normalized {@link HttpRequest} with `body`/`query`/`params`
 * replaced by their validated DTO instances and the application session forwarded from the provider's raw request.
 *
 * The handler's declared signature is the seam's `(request, response)`; typing the first parameter as this interface
 * (which is `HttpRequest` plus the optional `session`) lets a handler read the session without a cast, while a handler
 * that only needs the validated inputs can keep using `HttpRequest`.
 */
export type HttpRouteRequest = HttpRequest & { session?: Session };

/** The normalized inbound request and outbound response a route is executed against. */
export interface HttpRouteExecutionContext {
  request: HttpRequest;
  response: HttpResponse;
}

/**
 * The result of mapping a thrown value to the response the inbound `ErrorFilter` would have produced. An
 * `HttpException`-like error keeps its status and response body; anything else becomes the filter's 500 shape.
 */
export interface MappedHttpError {
  status: number;
  body: unknown;
}

/** Duck-types Nest's `HttpException` (and any lookalike) by its `getStatus`/`getResponse` pair. */
function isHttpExceptionLike(error: unknown): error is { getStatus: () => number; getResponse: () => unknown } {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { getStatus?: unknown; getResponse?: unknown };
  return typeof candidate.getStatus === "function" && typeof candidate.getResponse === "function";
}

/**
 * Maps a thrown error to `{ status, body }` in the shape the backend's global `ErrorFilter` emits: an HTTP error keeps
 * its own status/body, and any other error becomes `500 { error, stack }`. Providers use this so migrated handlers do
 * not need their own error handling.
 */
export function mapThrownError(error: unknown): MappedHttpError {
  if (isHttpExceptionLike(error)) return { status: error.getStatus(), body: error.getResponse() };

  const err = error as Error | undefined;
  return { status: 500, body: { error: String(error), stack: err?.stack } };
}

/** Produces the normalized request by validating each declared input and forwarding the session. */
async function buildRequest(spec: HttpRouteSpec, request: HttpRequest): Promise<HttpRouteRequest> {
  const raw = request.raw as RequestWithSession | undefined;
  const declared = spec.request ?? {};

  return {
    ...request,
    body: await validateDto(declared.body, request.body),
    query: (await validateDto(declared.query, request.query)) as Record<string, unknown>,
    params: (await validateDto(declared.params, request.params)) as Record<string, string>,
    session: raw?.session
  };
}

/**
 * Validates the inputs a route declares and invokes its handler with the normalized request.
 *
 * Everything the handler needs is carried on the request or passed alongside it: `body`/`query`/`params` are the
 * validated instances, `session` is the request session (undefined when unauthenticated), the provider's raw request
 * is `request.raw` (the `req`), and the normalized `response` is the `res` the handler mutates. This keeps the seam's
 * `(request, response)` handler signature meaningful while still handing the handler the full validated input.
 *
 * Auth is deliberately not performed here: the provider's request pipeline is expected to have populated the session
 * before the route runs. (See `http-routes.plugin.ts` for how the current `http-nest` provider orders its middleware.)
 */
export async function executeHttpRoute(spec: HttpRouteSpec, context: HttpRouteExecutionContext): Promise<void> {
  const request = await buildRequest(spec, context.request);
  await spec.handler(request, context.response);
}
