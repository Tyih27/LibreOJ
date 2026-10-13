import { defineDomainPlugin } from "./define-domain-plugin";

import { DiscussionModule } from "../../discussion/discussion.module";

/**
 * The plugin that contributes the discussion domain's Nest module to the application root.
 *
 * {@link DiscussionModule} keeps its own imports and stays reachable from homepage and problem.
 */
export const discussionPlugin = defineDomainPlugin("@libreoj/backend-domain-discussion", DiscussionModule);
