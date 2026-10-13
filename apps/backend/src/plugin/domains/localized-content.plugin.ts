import { defineDomainPlugin } from "./define-domain-plugin";

import { LocalizedContentModule } from "../../localized-content/localized-content.module";

/** The plugin that contributes the localized-content domain's Nest module to the application root. */
export const localizedContentPlugin = defineDomainPlugin(
  "@libreoj/backend-domain-localized-content",
  LocalizedContentModule
);
