import { defineDomainPlugin } from "./define-domain-plugin";

import { MetricsModule } from "../../metrics/metrics.module";

/**
 * The plugin that contributes the metrics domain's Nest module to the application root.
 *
 * Metrics is a leaf domain: {@link MetricsModule} only exports `MetricsService`, which `ErrorFilter` and the global
 * `MetricsMiddleware` inject; contributing it through the shared {@link defineDomainPlugin} shape keeps it resolving
 * without a static `AppModule` import.
 */
export const metricsPlugin = defineDomainPlugin("@libreoj/backend-domain-metrics", MetricsModule);
