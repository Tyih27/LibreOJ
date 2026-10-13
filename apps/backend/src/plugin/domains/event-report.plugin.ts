import { defineDomainPlugin } from "./define-domain-plugin";

import { EventReportModule } from "../../event-report/event-report.module";

/** The plugin that contributes the event-report domain's Nest module to the application root. */
export const eventReportPlugin = defineDomainPlugin("@libreoj/backend-domain-event-report", EventReportModule);
