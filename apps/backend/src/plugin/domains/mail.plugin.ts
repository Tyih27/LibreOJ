import { defineDomainPlugin } from "./define-domain-plugin";

import { MailModule } from "../../mail/mail.module";

/**
 * The plugin that contributes the mail domain's Nest module to the application root.
 *
 * Mail is a leaf domain: {@link MailModule} exports `MailService` and is otherwise reached through `AuthModule`, so
 * contributing it through the shared {@link defineDomainPlugin} shape makes its registration explicit.
 */
export const mailPlugin = defineDomainPlugin("@libreoj/backend-domain-mail", MailModule);
