/**
 * Service Definitions for the backend's infrastructure services.
 *
 * These are backend-internal seams: the contract is the concrete service's own type (matching the Cordis/dsh model,
 * where a service's definition is its class/interface and there is no separately mirrored contract package). They live
 * here rather than in `@libreoj/plugin-api` because nothing outside the backend consumes them; `plugin-api` is
 * reserved for seams that cross the Backend-Judge boundary.
 *
 * The services are registered by the `@libreoj/backend-infra` plugin once Nest has created the application (see
 * `infra.plugin.ts`), and resolved by consumers through `plugin/services.ts`.
 */

import type { DataSource } from "typeorm";

import type { ConfigService } from "../config/config.service";
import type { FileService } from "../file/file.service";
import type { MailService } from "../mail/mail.service";
import type { ProblemDataImporterRegistry } from "../problem-data-import/importer";
import type { LockService } from "../redis/lock.service";
import type { RedisService } from "../redis/redis.service";

/** The backend configuration (the Nest-managed instance). */
export const BACKEND_CONFIG = "backendConfig";

/** The TypeORM data source. */
export const BACKEND_DATABASE = "backendDatabase";

/** The Redis cache client. */
export const BACKEND_REDIS = "backendRedis";

/** The distributed lock service. */
export const BACKEND_LOCK = "backendLock";

/** The object storage (MinIO) service. */
export const BACKEND_STORAGE = "backendStorage";

/** The mail service. */
export const BACKEND_MAIL = "backendMail";

/** The problem data importers used to auto-detect subtasks from testdata. */
export const PROBLEM_DATA_IMPORTERS = "problemDataImporters";

/** The registry of Nest modules contributed by backend domain plugins. */
export const BACKEND_DOMAIN_MODULES = "backendDomainModules";

/** The backend configuration service, as provided by the backend. */
export type BackendConfig = ConfigService;

/** The data source, as provided by the backend. */
export type BackendDatabase = DataSource;

/** The Redis service, as provided by the backend. */
export type BackendRedis = RedisService;

/** The lock service, as provided by the backend. */
export type BackendLock = LockService;

/** The storage service, as provided by the backend. */
export type BackendStorage = FileService;

/** The mail service, as provided by the backend. */
export type BackendMail = MailService;

/** The problem data importer registry, as provided by the backend. */
export type BackendProblemDataImporters = ProblemDataImporterRegistry;

/**
 * The registry a domain plugin uses to contribute its Nest module(s) to the application root.
 *
 * `add` records a module and returns a remover that unregisters it, so a domain plugin ties the registration to its
 * own lifetime with `ctx.effect(() => modules.add(SomeModule))`. `list` returns the contributed modules in
 * registration order, which `main.ts` appends to `AppModule`'s imports.
 */
export interface BackendDomainModules {
  add(module: unknown): () => void;
  list(): unknown[];
}
