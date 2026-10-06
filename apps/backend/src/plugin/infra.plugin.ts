import { Logger } from "@nestjs/common";

import { HTTP } from "@libreoj/plugin-api";
import type { PluginDefinition } from "@libreoj/plugin-core";
import type { HttpNestServer } from "@libreoj/plugin-http-nest";
import { DataSource } from "typeorm";

import { BACKEND_CONFIG, BACKEND_DATABASE, BACKEND_LOCK, BACKEND_MAIL, BACKEND_REDIS, BACKEND_STORAGE } from "./seam";

import { ConfigService } from "../config/config.service";
import { FileService } from "../file/file.service";
import { MailService } from "../mail/mail.service";
import { LockService } from "../redis/lock.service";
import { RedisService } from "../redis/redis.service";

/**
 * The plugin that bridges the backend's Nest-resolved infrastructure services into the kernel.
 *
 * The Nest application is created by the `http` provider's `start` (which runs before this plugin, because the host
 * starts plugins in load order), so by the time this plugin starts the application exists and its providers can be
 * resolved. Each service is registered under a {@link seam} name; a future domain plugin declares the ones it needs in
 * `inject.required` and the kernel activates it once they are present.
 *
 * This deliberately registers the Nest-managed instances rather than constructing new ones, so a migrated consumer and
 * the remaining Nest code share the same objects.
 */
export const infraPlugin: PluginDefinition = {
  name: "@libreoj/backend-infra",
  inject: { required: [HTTP] },
  apply() {
    // Nothing to register up front; the infra services are bridged in `start`, once Nest has created the application.
  },
  start(ctx) {
    const { application } = ctx.get<HttpNestServer>(HTTP);
    if (!application) {
      throw new Error("The http provider did not create a Nest application; cannot bridge the infra services");
    }

    const config = application.get(ConfigService);
    const database = application.get(DataSource);
    const redis = application.get(RedisService);
    const lock = application.get(LockService);
    const storage = application.get(FileService);
    const mail = application.get(MailService);

    ctx.set(BACKEND_CONFIG, config);
    ctx.set(BACKEND_DATABASE, database);
    ctx.set(BACKEND_REDIS, redis);
    ctx.set(BACKEND_LOCK, lock);
    ctx.set(BACKEND_STORAGE, storage);
    ctx.set(BACKEND_MAIL, mail);

    Logger.log(
      "infra seams registered: backendConfig, backendDatabase, backendRedis, backendLock, backendStorage, backendMail",
      "Bootstrap"
    );
  }
};
