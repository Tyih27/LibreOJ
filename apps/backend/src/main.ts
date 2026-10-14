import util from "util";
import cluster from "cluster";
import * as path from "node:path";

import { Logger, ValidationPipe, type NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

import { HTTP } from "@libreoj/plugin-api";
import { codeLanguagePlugin } from "@libreoj/plugin-code-language";
import {
  ChainResolver,
  composeLayers,
  InlineResolver,
  NodeResolver,
  PluginHost,
  type PluginDefinition
} from "@libreoj/plugin-core";
import {
  createHttpNestPlugin,
  type HttpNestServer,
  type NestApplicationLike,
  type NestFactoryLike
} from "@libreoj/plugin-http-nest";

import getGitRepoInfo from "git-repo-info";
import moment from "moment";
import { Request, Response, json } from "express"; // eslint-disable-line import/no-extraneous-dependencies
import {
  RateLimiterClusterMaster,
  RateLimiterCluster,
  RateLimiterMemory,
  RateLimiterAbstract,
  IRateLimiterOptions
} from "rate-limiter-flexible";

import { AppModule } from "./app.module";
import { ConfigService } from "./config/config.service";
import { MigrationService } from "./migration/migration.service";
import { ErrorFilter } from "./error.filter";
import { RecaptchaFilter } from "./recaptcha.filter";
import { ClusterService } from "./cluster/cluster.service";
import type { BackendBundleName } from "./plugin/bundles";
import { domainModulesPlugin } from "./plugin/domain-modules.plugin";
import { auditPlugin } from "./plugin/domains/audit.plugin";
import { clusterPlugin } from "./plugin/domains/cluster.plugin";
import { configPlugin } from "./plugin/domains/config.plugin";
import { corsPlugin } from "./plugin/domains/cors.plugin";
import { eventReportPlugin } from "./plugin/domains/event-report.plugin";
import { discussionPlugin } from "./plugin/domains/discussion.plugin";
import { filePlugin } from "./plugin/domains/file.plugin";
import { groupPlugin } from "./plugin/domains/group.plugin";
import { homepagePlugin } from "./plugin/domains/homepage.plugin";
import { localizedContentPlugin } from "./plugin/domains/localized-content.plugin";
import { mailPlugin } from "./plugin/domains/mail.plugin";
import { metricsPlugin } from "./plugin/domains/metrics.plugin";
import { permissionPlugin } from "./plugin/domains/permission.plugin";
import { problemTypePlugin } from "./plugin/domains/problem-type.plugin";
import { settingsPlugin } from "./plugin/domains/settings.plugin";
import { infraPlugin } from "./plugin/infra.plugin";
import { httpRoutesPlugin } from "./plugin/http-routes.plugin";
import { problemTypeRegistryPlugin } from "./plugin/problem-type-registry.plugin";
import { problemDataImportersPlugin } from "./plugin/problemDataImporters.plugin";
import { setPluginHost } from "./plugin/plugin-host";
import { getBackendDomainModules } from "./plugin/services";

// eslint-disable-next-line no-extend-native
String.prototype.format = function format(...args) {
  return util.format.call(undefined, this, ...args);
};

export const appGitRepoInfo = getGitRepoInfo();

async function runMigration(app: NestExpressApplication, migrationConfigFile: string) {
  const migrationService = app.get(MigrationService);
  await migrationService.migrate(migrationConfigFile, app);
}

async function bootstrap() {
  // Get package info
  // eslint-disable-next-line @typescript-eslint/no-var-requires, import/extensions
  const packageInfo = require("../package.json");
  const appVersion = `v${packageInfo.version}`;
  const gitRepoVersion = appGitRepoInfo.abbreviatedSha
    ? ` (Git revision ${appGitRepoInfo.abbreviatedSha} on ${moment(appGitRepoInfo.committerDate).format(
        "YYYY-MM-DD H:mm:ss"
      )})`
    : "";

  if (cluster.isMaster) Logger.log(`Starting ${packageInfo.name} version ${appVersion}${gitRepoVersion}`, "Bootstrap");

  // The HTTP provider needs the bind address before it is mounted, and the migration branch must not listen. The
  // configuration is read here through a second `ConfigService`: it is a plain class with no Nest dependency, so it
  // resolves to the same validated configuration the Nest application will build, and lets both decisions be made
  // before the kernel is loaded.
  const bootstrapConfigService = new ConfigService();
  const migrationConfigFile = process.env.LIBREOJ_MIGRATION_CONFIG_FILE;

  // Replicates the configuration the old `initialize()` applied right after `NestFactory.create`.
  const configureApp = async (app: unknown): Promise<void> => {
    const nestApp = app as NestExpressApplication;
    const configService = nestApp.get(ConfigService);

    nestApp.setGlobalPrefix("api");
    nestApp.useGlobalFilters(nestApp.get(ErrorFilter), nestApp.get(RecaptchaFilter));
    nestApp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    nestApp.use(json({ limit: "1024mb" }));
    if (configService.config.security.rateLimit) {
      const clusterService = nestApp.get(ClusterService);
      const rateLimiterConfig: IRateLimiterOptions = {
        points: configService.config.security.rateLimit.maxRequests,
        duration: configService.config.security.rateLimit.durationSeconds
      };

      let rateLimiter: RateLimiterAbstract;

      if (clusterService.enabled) {
        // eslint-disable-next-line no-new
        if (clusterService.isMaster) new RateLimiterClusterMaster();
        else {
          rateLimiter = new RateLimiterCluster(rateLimiterConfig);
        }
      } else rateLimiter = new RateLimiterMemory(rateLimiterConfig);

      nestApp.use((req: Request, res: Response, next: () => void) => {
        rateLimiter
          .consume(req.ip)
          .then(() => {
            next();
          })
          .catch(() => {
            res.status(429).send("Too Many Requests");
          });
      });
    }
    nestApp.set("trust proxy", configService.config.server.trustProxy);

    const options = new DocumentBuilder()
      .setTitle(packageInfo.name)
      .setDescription(packageInfo.description)
      .setVersion(appVersion)
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(nestApp, options);
    SwaggerModule.setup("/docs", nestApp, document);
  };

  const nestOptions: NestApplicationOptions =
    process.env.NODE_ENV === "production" ? { logger: ["warn", "error"] } : {};

  // The Nest runtime handed to the http provider, so the plugin shares this application's single @nestjs/core instance
  // (a second instance would break Nest's internal provider resolution).
  const nest: NestFactoryLike = {
    create: (module, options) =>
      NestFactory.create(module as never, options as never) as unknown as Promise<NestApplicationLike>
  };

  // The name -> definition table the profile's bundle names resolve through. The explicit `Record<BackendBundleName,
  // PluginDefinition>` type is the guard: `check-types` fails if a name declared in `plugin/bundles.ts` has no
  // definition here, or if a definition names a bundle that is not declared (and therefore not in the profile). The
  // `http` provider is the only definition that cannot be a module constant -- its plugin is built from the runtime
  // options above.
  const backendBundles: Record<BackendBundleName, PluginDefinition> = {
    "@libreoj/backend-domain-modules": domainModulesPlugin,
    "@libreoj/plugin-http-nest": createHttpNestPlugin({
      rootModuleFactory: () => ({ module: AppModule, imports: getBackendDomainModules().list() }),
      nest,
      host: bootstrapConfigService.config.server.hostname,
      port: bootstrapConfigService.config.server.port,
      configureApp,
      // The application binds the port inside `ClusterService.initialization` below, so the provider only creates
      // and configures the Nest application during its `start` phase.
      listen: false,
      nestOptions
    }),
    "@libreoj/backend-http-routes": httpRoutesPlugin,
    "@libreoj/backend-infra": infraPlugin,
    "@libreoj/backend-problem-data-import": problemDataImportersPlugin,
    "@libreoj/plugin-code-language": codeLanguagePlugin,
    "@libreoj/backend-domain-homepage": homepagePlugin,
    "@libreoj/backend-domain-audit": auditPlugin,
    "@libreoj/backend-domain-file": filePlugin,
    "@libreoj/backend-domain-mail": mailPlugin,
    "@libreoj/backend-domain-metrics": metricsPlugin,
    "@libreoj/backend-domain-settings": settingsPlugin,
    "@libreoj/backend-domain-cluster": clusterPlugin,
    "@libreoj/backend-domain-config": configPlugin,
    "@libreoj/backend-domain-cors": corsPlugin,
    "@libreoj/backend-domain-event-report": eventReportPlugin,
    "@libreoj/backend-domain-localized-content": localizedContentPlugin,
    "@libreoj/backend-domain-permission": permissionPlugin,
    "@libreoj/backend-domain-group": groupPlugin,
    "@libreoj/backend-domain-discussion": discussionPlugin,
    "@libreoj/backend-problem-type-registry": problemTypeRegistryPlugin,
    "@libreoj/backend-domain-problem-type": problemTypePlugin
  };

  // The backend's one composition root. The host is registered with the module-level accessor before `host.load()`, so
  // Nest-side factories (evaluated while Nest is created from inside `host.load`) can read the already-loaded host
  // through `getPluginHost()`. The root module is `AppModule` with the domain plugins' contributed modules appended:
  // Nest merges a DynamicModule's `imports` with the target module's static imports (`@nestjs/core` scanner), so
  // returning `{ module: AppModule, imports }` is additive and preserves the `AppModule` token/singleton.
  //
  // The resolver is a chain: in-tree bundles come from the in-memory map; a profile entry the map does not know is
  // resolved from the filesystem relative to the backend package root, so a third party can enable an installed plugin
  // through the profile without editing this file.
  const host = new PluginHost({
    resolver: new ChainResolver([
      new InlineResolver({ ...backendBundles }),
      new NodeResolver({ baseDir: path.resolve(__dirname, "..") })
    ]),
    failureMode: "fatal"
  });

  setPluginHost(host);

  // The profile names the bundles in load order; `composeLayers` turns it (plus the optional site patch) into the
  // layers `host.load` consumes. `backend-domain-modules` is listed first, so every domain plugin's `apply` can
  // register its Nest module(s) before the `http` provider's `start` evaluates the root-module factory.
  const profile = process.env.LIBREOJ_BACKEND_PROFILE ?? path.resolve(__dirname, "../../../profiles/backend.yaml");

  await host.load(composeLayers({ profile, homePatchFile: process.env.LIBREOJ_PATCH_FILE }));

  const httpServer = host.root.get<HttpNestServer>(HTTP);
  const app = httpServer.application as NestExpressApplication;

  if (migrationConfigFile)
    // The provider has created and configured the application without binding it, so migration behaves as before:
    // run against the configured application and never listen.
    await runMigration(app, migrationConfigFile);
  // Start Nest.js app
  else {
    const clusterService = app.get(ClusterService);
    await clusterService.initialization(async () => {
      await httpServer.listen();
      Logger.log(
        `${packageInfo.name} is listening on ${bootstrapConfigService.config.server.hostname}:${bootstrapConfigService.config.server.port}`,
        "Bootstrap"
      );
    });
  }
}

bootstrap().catch(err => {
  console.error(err); // eslint-disable-line no-console
  console.error("Error bootstrapping the application, exiting..."); // eslint-disable-line no-console
  process.exit(1);
});
