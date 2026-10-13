import { defineDomainPlugin } from "./define-domain-plugin";

import { AuditModule } from "../../audit/audit.module";

/**
 * The plugin that contributes the audit domain's Nest module to the application root.
 *
 * Auditing is a leaf domain: {@link AuditModule} imports only its TypeORM feature and exports `AuditService`, so
 * contributing it through the shared {@link defineDomainPlugin} shape keeps `AppModule`'s static imports smaller.
 */
export const auditPlugin = defineDomainPlugin("@libreoj/backend-domain-audit", AuditModule);
