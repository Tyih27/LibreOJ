import { defineDomainPlugin } from "./define-domain-plugin";

import { GroupModule } from "../../group/group.module";

/**
 * The plugin that contributes the group domain's Nest module to the application root.
 *
 * {@link GroupModule} keeps its own imports and stays reachable from discussion, problem, permission and auth.
 */
export const groupPlugin = defineDomainPlugin("@libreoj/backend-domain-group", GroupModule);
