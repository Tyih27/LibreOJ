import util from "util";
import cluster from "cluster";

import { Logger, ValidationPipe, type NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

import { HTTP } from "@libreoj/plugin-api";
import { codeLanguagePlugin } from "@libreoj/plugin-code-language";
import { InlineResolver, PluginHost } from "@libreoj/plugin-core";
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
import { infraPlugin } from "./plugin/infra.plugin";
import { problemDataImportersPlugin } from "./plugin/problemDataImporters.plugin";
import { setPluginHost } from "./plugin/plugin-host";

// eslint-disable-next-line no-extend-native
String.prototype.format = function format(...args) {
  return util.format.call(undefined, this, ...args);
};

export const appGitRepoInfo = getGitRepoInfo();

const HTTP_NEST_BUNDLE = "@libreoj/plugin-http-nest";
const BACKEND_INFRA_BUNDLE = "@libreoj/backend-infra";
const PROBLEM_DATA_IMPORT_BUNDLE = "@libreoj/backend-problem-data-import";
const CODE_LANGUAGE_BUNDLE = "@libreoj/plugin-code-language";

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

  // The backend's one composition root. The host is registered with the module-level accessor before `host.load()`, so
  // Nest-side factories (evaluated while Nest is created from inside `host.load`) can read the already-loaded host
  // through `getPluginHost()`. The Nest application is created from the original `AppModule`, unchanged, so the module
  // graph is preserved.
  const host = new PluginHost({
    resolver: new InlineResolver({
      [HTTP_NEST_BUNDLE]: createHttpNestPlugin({
        rootModule: AppModule,
        nest,
        host: bootstrapConfigService.config.server.hostname,
        port: bootstrapConfigService.config.server.port,
        configureApp,
        // The application binds the port inside `ClusterService.initialization` below, so the provider only creates
        // and configures the Nest application during its `start` phase.
        listen: false,
        nestOptions
      }),
      [BACKEND_INFRA_BUNDLE]: infraPlugin,
      [PROBLEM_DATA_IMPORT_BUNDLE]: problemDataImportersPlugin,
      [CODE_LANGUAGE_BUNDLE]: codeLanguagePlugin
    }),
    failureMode: "fatal"
  });

  setPluginHost(host);

  await host.load([
    { bundles: [HTTP_NEST_BUNDLE, BACKEND_INFRA_BUNDLE, PROBLEM_DATA_IMPORT_BUNDLE, CODE_LANGUAGE_BUNDLE] }
  ]);

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
