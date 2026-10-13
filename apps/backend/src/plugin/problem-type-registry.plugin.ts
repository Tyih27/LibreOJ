import { Logger } from "@nestjs/common";

import { HTTP } from "@libreoj/plugin-api";
import type { PluginDefinition } from "@libreoj/plugin-core";
import type { HttpNestServer } from "@libreoj/plugin-http-nest";

import { PROBLEM_TYPE_REGISTRY } from "./seam";
import { ProblemTypeRegistryService } from "./problem-type.registry";

import { ProblemType } from "../problem/problem.entity";
import { ProblemTypeInteractionService } from "../problem-type/types/interaction/problem-type.service";
import { ProblemTypeSubmitAnswerService } from "../problem-type/types/submit-answer/problem-type.service";
import { ProblemTypeTraditionalService } from "../problem-type/types/traditional/problem-type.service";

// The plugin is a process singleton, so the registry created in `apply` is stable across the plugin's lifetime.
let registry: ProblemTypeRegistryService | undefined;

/**
 * The plugin that provides the `problemTypeRegistry` seam.
 *
 * The two phases are split deliberately. The registry object is created and registered in `apply`, because the Nest-side
 * adapter (`ProblemTypeFactoryService`) injects it while Nest creates the application. The mapping from a problem type
 * to its service is filled in `start`, because the services are Nest providers (they inject `CodeLanguageService`) and
 * can only be resolved once the application exists. The kernel reconciles every plugin's `apply` to a fixed point
 * before it starts any plugin, and it starts plugins in load order, so by the time this plugin's `start` runs the
 * `http` provider -- listed earlier in the backend profile -- has already created the application.
 *
 * `HTTP` is required, so this plugin only activates once the `http` provider has published the application.
 */
export const problemTypeRegistryPlugin: PluginDefinition = {
  name: "@libreoj/backend-problem-type-registry",
  provide: [PROBLEM_TYPE_REGISTRY],
  inject: { required: [HTTP] },
  apply(ctx) {
    registry = new ProblemTypeRegistryService();
    ctx.set(PROBLEM_TYPE_REGISTRY, registry);
  },
  start(ctx) {
    const { application } = ctx.get<HttpNestServer>(HTTP);
    if (!application) {
      throw new Error("The http provider did not create a Nest application; cannot register the problem types");
    }

    const current = registry;
    if (!current) throw new Error("The problem type registry was not created in apply");

    current.register(ProblemType.Traditional, application.get(ProblemTypeTraditionalService));
    current.register(ProblemType.Interaction, application.get(ProblemTypeInteractionService));
    current.register(ProblemType.SubmitAnswer, application.get(ProblemTypeSubmitAnswerService));

    const registered = [ProblemType.Traditional, ProblemType.Interaction, ProblemType.SubmitAnswer].join(", ");
    Logger.log(`problem type registry registered: ${registered}`, "Bootstrap");
  }
};
