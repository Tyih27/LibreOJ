import { defineDomainPlugin } from "./define-domain-plugin";

import { SettingsModule } from "../../settings/settings.module";

/**
 * The plugin that contributes the settings domain's Nest module to the application root.
 *
 * Settings is a leaf domain: {@link SettingsModule} imports only its TypeORM feature and exports `SettingsService`,
 * which the `@Global` `SharedModule` re-exports, so contributing it through the shared {@link defineDomainPlugin}
 * shape makes its registration explicit.
 */
export const settingsPlugin = defineDomainPlugin("@libreoj/backend-domain-settings", SettingsModule);
