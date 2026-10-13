import { defineDomainPlugin } from "./define-domain-plugin";

import { ClusterModule } from "../../cluster/cluster.module";

/** The plugin that contributes the cluster domain's Nest module to the application root. */
export const clusterPlugin = defineDomainPlugin("@libreoj/backend-domain-cluster", ClusterModule);
