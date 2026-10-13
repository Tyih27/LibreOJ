import { defineDomainPlugin } from "./define-domain-plugin";

import { HomepageModule } from "../../homepage/homepage.module";

/**
 * The plugin that contributes the homepage domain's Nest module to the application root.
 *
 * It is listed after `@libreoj/backend-domain-modules` in the backend profile, so the registry is available for
 * `inject.required`; the shared {@link defineDomainPlugin} shape then resolves it and adds {@link HomepageModule}
 * through `ctx.effect`, which removes the module again when the plugin is disposed. The module keeps its own imports,
 * so the domain's providers still resolve inside the same Nest root module graph.
 */
export const homepagePlugin = defineDomainPlugin("@libreoj/backend-domain-homepage", HomepageModule);
