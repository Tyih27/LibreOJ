/**
 * Typed accessors for the backend's infrastructure services.
 *
 * A consumer (typically a migrated domain plugin) calls these to resolve a service from the composition root instead
 * of receiving it through Nest's constructor injection. Resolution is lazy: the `@libreoj/backend-infra` plugin must
 * already have registered the service, which the kernel guarantees for plugins that declare it in
 * `inject.required`.
 */

import type {
  BackendConfig,
  BackendDatabase,
  BackendDomainModules,
  BackendLock,
  BackendMail,
  BackendProblemDataImporters,
  BackendRedis,
  BackendStorage
} from "./seam";
import {
  BACKEND_CONFIG,
  BACKEND_DATABASE,
  BACKEND_DOMAIN_MODULES,
  BACKEND_LOCK,
  BACKEND_MAIL,
  BACKEND_REDIS,
  BACKEND_STORAGE,
  PROBLEM_DATA_IMPORTERS
} from "./seam";
import { getPluginHost } from "./plugin-host";

function resolve<T>(name: string): T {
  return getPluginHost().root.get<T>(name);
}

export function getBackendConfig(): BackendConfig {
  return resolve<BackendConfig>(BACKEND_CONFIG);
}

export function getDatabase(): BackendDatabase {
  return resolve<BackendDatabase>(BACKEND_DATABASE);
}

export function getRedis(): BackendRedis {
  return resolve<BackendRedis>(BACKEND_REDIS);
}

export function getLock(): BackendLock {
  return resolve<BackendLock>(BACKEND_LOCK);
}

export function getStorage(): BackendStorage {
  return resolve<BackendStorage>(BACKEND_STORAGE);
}

export function getMail(): BackendMail {
  return resolve<BackendMail>(BACKEND_MAIL);
}

export function getProblemDataImporters(): BackendProblemDataImporters {
  return resolve<BackendProblemDataImporters>(PROBLEM_DATA_IMPORTERS);
}

export function getBackendDomainModules(): BackendDomainModules {
  return resolve<BackendDomainModules>(BACKEND_DOMAIN_MODULES);
}
