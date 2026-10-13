import { Module, forwardRef, NestModule, MiddlewareConsumer, RequestMethod } from "@nestjs/common";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ErrorFilter } from "./error.filter";
import { RecaptchaFilter } from "./recaptcha.filter";
import { AuthMiddleware } from "./auth/auth.middleware";
import { MetricsMiddleware } from "./metrics/metrics.middleware";

import { SharedModule } from "./shared.module";
import { PluginModule } from "./plugin/plugin.module";
import { RedisModule } from "./redis/redis.module";
import { DatabaseModule } from "./database/database.module";
import { UserModule } from "./user/user.module";
import { AuthModule } from "./auth/auth.module";
import { ProblemModule } from "./problem/problem.module";
import { SubmissionModule } from "./submission/submission.module";
import { HackModule } from "./hack/hack.module";
import { JudgeModule } from "./judge/judge.module";
import { MigrationModule } from "./migration/migration.module";

@Module({
  imports: [
    SharedModule,
    PluginModule,
    forwardRef(() => DatabaseModule),
    forwardRef(() => RedisModule),
    forwardRef(() => UserModule),
    forwardRef(() => AuthModule),
    forwardRef(() => ProblemModule),
    forwardRef(() => SubmissionModule),
    forwardRef(() => HackModule),
    forwardRef(() => JudgeModule),
    forwardRef(() => MigrationModule)
  ],
  controllers: [AppController],
  providers: [AppService, ErrorFilter, RecaptchaFilter]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes({
      path: "*",
      method: RequestMethod.ALL
    });
    consumer.apply(MetricsMiddleware).forRoutes({
      path: "*",
      method: RequestMethod.ALL
    });
  }
}
