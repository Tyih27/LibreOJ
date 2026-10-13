import { defineDomainPlugin } from "./define-domain-plugin";

import { FileModule } from "../../file/file.module";

/**
 * The plugin that contributes the file domain's Nest module to the application root.
 *
 * The file domain is a leaf: {@link FileModule} imports only its TypeORM feature and exports `FileService`, so it is
 * contributed through the shared {@link defineDomainPlugin} shape rather than statically by `AppModule`.
 */
export const filePlugin = defineDomainPlugin("@libreoj/backend-domain-file", FileModule);
