/**
 * The typed, late-bound accessor for the backend's application services.
 *
 * A migrated `HttpRouteSpec` handler cannot receive its dependencies through Nest's constructor injection any more, and
 * it cannot hold service instances at registration time either: the `http-nest` provider freezes its router during its
 * own `start`, which runs before the route specs are mounted in some orderings, and the Nest-free `http-fastify`
 * provider has no DI container at all. Handlers therefore call {@link svc} *at request time* to resolve the services
 * they need by a stable camelCase key.
 *
 * The resolver behind {@link svc} is swappable:
 *
 * - {@link bindNestServiceResolver} makes `svc(key)` return `nestApp.get(ClassToken, { strict: false })` for each key.
 *   This is what the backend uses while Nest still owns the application services (the migration).
 * - {@link bindManualServiceResolver} makes `svc(key)` read the key off a plain object built by the composition root.
 *   This is the M7.5 cutover: the same route code keeps working once Nest is removed.
 *
 * The two bind functions are the only way to set the resolver; the current resolver itself is module-private so no
 * caller can reach past the keys the {@link BackendServices} interface declares.
 *
 * This is a deliberate, *local* service locator confined to the HTTP route layer. Business services are not registered
 * in the plugin kernel.
 */

import type { AuditService } from "./audit/audit.service";
import type { AuthEmailVerificationCodeService } from "./auth/auth-email-verification-code.service";
import type { AuthIpLocationService } from "./auth/auth-ip-location.service";
import type { AuthSessionService } from "./auth/auth-session.service";
import type { AuthService } from "./auth/auth.service";
import type { ClusterService } from "./cluster/cluster.service";
import type { CodeLanguageService } from "./code-language/code-language.service";
import type { ConfigService } from "./config/config.service";
import type { DiscussionService } from "./discussion/discussion.service";
import type { EventReportService } from "./event-report/event-report.service";
import type { FileService } from "./file/file.service";
import type { GroupService } from "./group/group.service";
import type { HackService } from "./hack/hack.service";
import type { HomepageService } from "./homepage/homepage.service";
import type { JudgeClientService } from "./judge/judge-client.service";
import type { JudgeQueueService } from "./judge/judge-queue.service";
import type { LocalizedContentService } from "./localized-content/localized-content.service";
import type { MailService } from "./mail/mail.service";
import type { MetricsService } from "./metrics/metrics.service";
import type { MigrationService } from "./migration/migration.service";
import type { UserMigrationService } from "./migration/user-migration.service";
import type { PermissionService } from "./permission/permission.service";
import type { ProblemTypeFactoryService } from "./problem-type/problem-type-factory.service";
import type { ProblemService } from "./problem/problem.service";
import type { LockService } from "./redis/lock.service";
import type { RedisService } from "./redis/redis.service";
import type { SettingsService } from "./settings/settings.service";
import type { SubmissionProgressService } from "./submission/submission-progress.service";
import type { SubmissionStatisticsService } from "./submission/submission-statistics.service";
import type { SubmissionService } from "./submission/submission.service";
import type { UserPrivilegeService } from "./user/user-privilege.service";
import type { UserService } from "./user/user.service";

/**
 * The application services a migrated route handler may resolve through {@link svc}. Each key names one service and its
 * value type is the service's instance type, so `svc("userService")` is typed as `UserService` with no cast.
 */
export interface BackendServices {
  configService: ConfigService;
  redisService: RedisService;
  lockService: LockService;
  authService: AuthService;
  authSessionService: AuthSessionService;
  authEmailVerificationCodeService: AuthEmailVerificationCodeService;
  authIpLocationService: AuthIpLocationService;
  userService: UserService;
  userPrivilegeService: UserPrivilegeService;
  userMigrationService: UserMigrationService;
  submissionService: SubmissionService;
  submissionProgressService: SubmissionProgressService;
  submissionStatisticsService: SubmissionStatisticsService;
  problemService: ProblemService;
  problemTypeFactoryService: ProblemTypeFactoryService;
  codeLanguageService: CodeLanguageService;
  groupService: GroupService;
  permissionService: PermissionService;
  discussionService: DiscussionService;
  homepageService: HomepageService;
  hackService: HackService;
  judgeClientService: JudgeClientService;
  judgeQueueService: JudgeQueueService;
  fileService: FileService;
  mailService: MailService;
  metricsService: MetricsService;
  clusterService: ClusterService;
  settingsService: SettingsService;
  auditService: AuditService;
  localizedContentService: LocalizedContentService;
  migrationService: MigrationService;
  eventReportService: EventReportService;
}

/** A key of {@link BackendServices}. */
type ServiceKey = keyof BackendServices;

let currentResolver: ((key: ServiceKey) => unknown) | null = null;

/**
 * Resolves a backend service by key. Intended to be called at request time from a route handler.
 *
 * Throws when no resolver is bound yet, which means the composition root never called one of the two bind functions.
 */
export function svc<K extends ServiceKey>(key: K): BackendServices[K] {
  if (currentResolver === null) {
    throw new Error(
      `The backend service resolver is not bound; cannot resolve "${key}". ` +
        "Bind it with bindNestServiceResolver (during migration) or bindManualServiceResolver (after cutover)."
    );
  }
  return currentResolver(key) as BackendServices[K];
}

/**
 * Binds {@link svc} to a Nest application. Each key is resolved lazily as `nestApp.get(tokens[key], { strict: false })`,
 * so the lookup crosses module boundaries (the same way Nest's own `ModuleRef`-based lookup does). This is the
 * migration-time binding; the M7.5 cutover replaces it with {@link bindManualServiceResolver}.
 */
export function bindNestServiceResolver(
  nestApp: { get(token: unknown, options?: unknown): unknown },
  tokens: Record<ServiceKey, unknown>
): void {
  currentResolver = key => nestApp.get(tokens[key], { strict: false });
}

/**
 * Binds {@link svc} to a plain object of already-constructed services. This is the M7.5 cutover: the composition root
 * builds the object once, and every migrated route keeps calling {@link svc} unchanged.
 */
export function bindManualServiceResolver(services: BackendServices): void {
  currentResolver = key => services[key];
}
