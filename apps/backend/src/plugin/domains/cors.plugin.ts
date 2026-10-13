import { defineDomainPlugin } from "./define-domain-plugin";

import { CorsModule } from "../../cors/cors.module";

/** The plugin that contributes the cors domain's Nest module to the application root. */
export const corsPlugin = defineDomainPlugin("@libreoj/backend-domain-cors", CorsModule);
