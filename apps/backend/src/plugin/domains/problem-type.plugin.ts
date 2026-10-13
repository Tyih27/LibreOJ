import { defineDomainPlugin } from "./define-domain-plugin";

import { ProblemTypeModule } from "../../problem-type/problem-type.module";

/**
 * The plugin that contributes the problem-type domain's Nest module to the application root.
 *
 * {@link ProblemTypeModule} keeps its three type services as providers -- they inject `CodeLanguageService`, so they
 * must stay in the Nest module graph -- and their mapping into the `problemTypeRegistry` seam is published by the
 * `@libreoj/backend-problem-type-registry` plugin.
 */
export const problemTypePlugin = defineDomainPlugin("@libreoj/backend-domain-problem-type", ProblemTypeModule);
