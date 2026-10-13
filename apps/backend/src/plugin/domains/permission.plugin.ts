import { defineDomainPlugin } from "./define-domain-plugin";

import { PermissionModule } from "../../permission/permission.module";

/** The plugin that contributes the permission domain's Nest module to the application root. */
export const permissionPlugin = defineDomainPlugin("@libreoj/backend-domain-permission", PermissionModule);
