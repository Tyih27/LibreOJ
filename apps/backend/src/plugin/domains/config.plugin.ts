import { defineDomainPlugin } from "./define-domain-plugin";

import { ConfigModule } from "../../config/config.module";

/** The plugin that contributes the config domain's Nest module to the application root. */
export const configPlugin = defineDomainPlugin("@libreoj/backend-domain-config", ConfigModule);
