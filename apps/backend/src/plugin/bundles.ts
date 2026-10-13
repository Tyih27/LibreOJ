/**
 * The backend's bundle names, in load order.
 *
 * This is the typed mirror of `profiles/backend.yaml`: the profile decides what actually loads, and
 * `apps/backend/test/backend-profile.test.ts` asserts the two agree. The name → definition table lives in `main.ts` as a
 * `Record<BackendBundleName, PluginDefinition>`, so `check-types` fails if a name is added here without a definition or
 * a definition is added for a name that is not declared. Together those two checks close the only gap that could not be
 * caught at runtime: a bundle the profile names but no resolver knows aborts `host.load` -- that is, aborts boot.
 *
 * The order is not arbitrary. `backend-domain-modules` must be applied before any domain plugin (it provides the
 * registry they inject), and the `http` provider must be started before `backend-infra` (whose `start` reads the
 * application it created).
 */
export const BACKEND_BUNDLE_NAMES = [
  "@libreoj/backend-domain-modules",
  "@libreoj/plugin-http-nest",
  "@libreoj/backend-infra",
  "@libreoj/backend-problem-data-import",
  "@libreoj/plugin-code-language",
  "@libreoj/backend-domain-homepage",
  "@libreoj/backend-domain-audit",
  "@libreoj/backend-domain-file",
  "@libreoj/backend-domain-mail",
  "@libreoj/backend-domain-metrics",
  "@libreoj/backend-domain-settings",
  "@libreoj/backend-domain-cluster",
  "@libreoj/backend-domain-config",
  "@libreoj/backend-domain-cors",
  "@libreoj/backend-domain-event-report",
  "@libreoj/backend-domain-localized-content",
  "@libreoj/backend-domain-permission",
  "@libreoj/backend-domain-group",
  "@libreoj/backend-domain-discussion",
  "@libreoj/backend-problem-type-registry",
  "@libreoj/backend-domain-problem-type"
] as const;

/** A bundle name the backend profile may list. */
export type BackendBundleName = typeof BACKEND_BUNDLE_NAMES[number];
