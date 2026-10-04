import { dump } from "js-yaml";
import { resolveConfig, type ConfigLayer, type PluginSource, type ResolvedConfig } from "./config";
import { Context } from "./context";
import { sortKeysDeep, type PluginDumpState } from "./dump";
import type { Fiber } from "./fiber";
import { isPlainObject } from "./object";
import type { ModuleResolver, PluginDefinition, PluginState } from "./plugin";

/** A plugin entry tracked by the host, exposed for assertions and diagnostics. */
export interface PluginRecord {
  name: string;
  source: PluginSource;
  definition: PluginDefinition;
  /** The effective configuration: plugin defaults, then profile layers, then validated by the plugin schema. */
  config: Record<string, unknown>;
  state: PluginState;
  /** The plugin's current context. Rebuilt whenever the plugin is deactivated and re-activated. */
  context: Context;
  error?: unknown;
}

export interface PluginHostOptions {
  resolver: ModuleResolver;
  /** What to do when `apply` or `start` throws: skip and record, or fail the load. Defaults to "skip". */
  failureMode?: "skip" | "fatal";
  onError?: (name: string, error: unknown) => void;
}

/** A record bound to the fiber that backs it, so lifecycle fields stay live. */
interface InternalRecord extends PluginRecord {
  readonly fiber: Fiber;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The composition root for a plugin tree. It resolves an ordered plugin list from a layered configuration, mounts each
 * enabled plugin through {@link Context.plugin}, and drives the kernel to a fixed point: dependency gating is owned by
 * the {@link FiberManager}, while the host layers `start` on top of a settled tree.
 *
 * Reconciliation is serialized through a single promise chain: a start that provides a service can activate a further
 * plugin, so the host repeats "settle + start" until neither pass changes anything.
 */
export class PluginHost {
  readonly root: Context;

  private readonly options: PluginHostOptions;
  private readonly failureMode: "skip" | "fatal";
  private readonly records: InternalRecord[] = [];
  private resolved: ResolvedConfig = { plugins: [], warnings: [] };
  private loaded = false;
  private disposed = false;
  private chain: Promise<void> = Promise.resolve();
  private current: Promise<void> | null = null;
  /** Set when a request arrives while a settle is in flight, forcing one more pass before the job resolves. */
  private pendingPass = false;
  /**
   * Serializes runtime tree mutations (install/uninstall/reload) so their "resolve -> mutate records/resolved ->
   * settle" sequences cannot interleave. Distinct from the settle chain, which coalesces passes rather than running
   * each request once.
   */
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(options: PluginHostOptions) {
    this.options = options;
    this.failureMode = options.failureMode ?? "skip";
    this.root = new Context();
    this.root.fibers.configure({ failureMode: this.failureMode, onError: options.onError });
  }

  /**
   * The tracked plugin records, in load order. Disabled entries are not loaded and thus not listed. Returns a copy,
   * so a caller cannot mutate the host's internal load order through the array.
   */
  get plugins(): readonly PluginRecord[] {
    return [...this.records];
  }

  /**
   * The first fatal `apply`/`start` error, or `null`. Fatal mode rejects the triggering `load`/`reconcile` promise;
   * this accessor keeps the error observable afterwards (including for reconciles triggered by external service
   * changes, which have no promise the caller awaited).
   */
  get fatalError(): unknown {
    return this.root.fibers.fatalError;
  }

  /**
   * Resolves `layers`, mounts every enabled plugin, and runs the tree to a fixed point: the kernel reconciles
   * dependencies and the host starts every active plugin, repeatedly, until a `start` that provides a service can no
   * longer activate a further plugin. Resolves only once no activation or start remains pending.
   *
   * A resolver failure or a `config.parse` failure rejects directly and is deliberately not routed through the
   * failure mode: unlike a plugin's `apply`/`start`, a plugin that cannot be resolved or whose configuration is
   * invalid is a load-time configuration/installation error, which should be fatal regardless of `failureMode`.
   */
  async load(layers: ConfigLayer[]): Promise<void> {
    if (this.disposed) throw new Error("PluginHost has been disposed");
    if (this.loaded) throw new Error("PluginHost.load() has already been called");
    this.loaded = true;

    this.resolved = resolveConfig(layers);

    // Subscribe before mounting: an activation triggered by any service change (including a runtime one with no
    // caller promise) must run `start` for the reactivated plugin. The subscription lives on the root context, so it
    // is revoked with the host's teardown.
    this.root.effect(() => this.root.fibers.onSettled(this.handleFibersSettled));

    for (const entry of this.resolved.plugins) {
      if (entry.disabled) continue;

      const definition = await this.options.resolver.resolve(entry.name);
      const fiber = this.root.plugin(definition, entry.config);
      this.records.push({
        name: entry.name,
        source: entry.source,
        definition: fiber.definition,
        config: fiber.config,
        get state() {
          return fiber.state;
        },
        get context() {
          return fiber.context;
        },
        get error() {
          return fiber.error;
        },
        fiber
      });
    }

    await this.enqueueSettle();
  }

  /**
   * Runs dependency reconciliation and start to a fixed point; resolves once the tree is stable again. Rejects with
   * the offending error when `failureMode` is `"fatal"`.
   */
  reconcile(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.enqueueSettle();
  }

  /**
   * Mounts a plugin by name at runtime, after `load` has composed the initial tree. The plugin is resolved through the
   * host's resolver, mounted on the root context, and driven to a fixed point before this resolves, so a plugin whose
   * required services are already present is activated and started exactly as during `load`. The installation is
   * tracked like a loaded plugin and appears in {@link plugins} / {@link dumpConfig}.
   *
   * Requires `load` to have run: the initial layer composition establishes the host's root wiring, and a runtime
   * plugin is an addition to that tree. Installing a name that is already mounted throws.
   */
  install(name: string, config?: unknown): Promise<Fiber> {
    return this.runExclusive(() => this.mount(name, config, false, "runtime"));
  }

  /**
   * Unloads a plugin by name at runtime. Its fiber is disposed -- revoking the services it registered, which the
   * kernel reacts to by deactivating its dependents -- and it is removed from the host's records and resolved tree, so
   * {@link plugins} and {@link dumpConfig} no longer list it. Reconciliation settles before this resolves. Requires
   * `load`; uninstalling a name that is not mounted throws.
   */
  uninstall(name: string): Promise<void> {
    return this.runExclusive(() => this.doUninstall(name));
  }

  /**
   * Reloads a plugin by name: `uninstall` then a fresh `install`, so a CommonJS entry changed on disk is re-read (see
   * {@link NodeResolver}). The plugin's layer configuration and source are preserved across the reload. Returns the
   * new fiber. Requires `load`; reloading a name that is not mounted throws.
   *
   * A fresh resolve/mount failure is rolled back by remounting the original definition (non-fresh, same source and
   * config); the original error is still thrown so the reload is observably a failure.
   */
  reload(name: string): Promise<Fiber> {
    return this.runExclusive(() => this.doReload(name));
  }

  /** Disposes every plugin in reverse load order, then the root context (clearing the shared service scope). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Wait for any runtime mutation to finish (observing `disposed` and aborting), then let any in-flight settle
    // observe `disposed` and stop before contexts are torn down.
    await this.mutationChain;
    await this.chain;

    await this.root.fibers.dispose();
    await this.root.dispose();
  }

  /** The body of {@link uninstall}; must run inside the mutation critical section. */
  private async doUninstall(name: string): Promise<void> {
    this.assertLoaded("uninstall");
    const index = this.records.findIndex(record => record.name === name);
    if (index < 0) throw new Error(`Plugin "${name}" is not installed`);

    const [record] = this.records.splice(index, 1);
    const resolvedIndex = this.resolved.plugins.findIndex(entry => entry.name === name);
    if (resolvedIndex >= 0) this.resolved.plugins.splice(resolvedIndex, 1);

    await record.fiber.dispose();
    await this.enqueueSettle();
  }

  /** The body of {@link reload}; must run inside the mutation critical section. */
  private async doReload(name: string): Promise<Fiber> {
    this.assertLoaded("reload");
    const recordIndex = this.records.findIndex(candidate => candidate.name === name);
    if (recordIndex < 0) throw new Error(`Plugin "${name}" is not installed`);

    const record = this.records[recordIndex];
    const source = record.source;
    const resolvedIndex = this.resolved.plugins.findIndex(entry => entry.name === name);
    const config = resolvedIndex >= 0 ? this.resolved.plugins[resolvedIndex].config : {};

    await this.doUninstall(name);
    try {
      return await this.mount(name, config, true, source);
    } catch (error) {
      // Roll back to the original definition so a failed reload does not leave the plugin uninstalled.
      try {
        await this.mount(name, config, false, source, { records: recordIndex, resolved: resolvedIndex });
      } catch (restoreError) {
        throw new Error(
          `Plugin "${name}" failed to reload (${describeError(error)}) and could not be restored ` +
            `(${describeError(restoreError)})`
        );
      }
      throw error;
    }
  }

  /**
   * Resolves, mounts, and settles a plugin added after `load`. The record and its resolved entry are registered before
   * the settle, so the host's start loop sees the new fiber and the dump reflects it immediately. `source` labels a
   * brand-new entry; an existing (previously disabled) entry keeps the source it was resolved with, and -- unless the
   * caller explicitly supplies a config -- its profile configuration. `position`, when given, re-inserts the
   * record/resolved entry at those indices instead of appending -- used by {@link reload}'s rollback so a restored
   * plugin keeps its original place in the tree.
   *
   * The registration is transactional: if the settle/start pass that follows throws (notably a fatal apply), the
   * entry and record pushed above are removed again -- a reused disabled entry is restored to its prior
   * `disabled`/`config` -- and the fiber is unloaded, before the original error is rethrown. This is what lets
   * {@link doReload} remount the original plugin after a failed fresh mount instead of colliding with the leftover.
   */
  private async mount(
    name: string,
    config: unknown,
    fresh: boolean,
    source: PluginSource,
    position?: { records: number; resolved: number }
  ): Promise<Fiber> {
    this.assertLoaded(fresh ? "reload" : "install");
    if (this.records.some(record => record.name === name)) {
      throw new Error(`Plugin "${name}" is already installed`);
    }

    const definition = await this.options.resolver.resolve(name, { fresh });

    // A runtime install may target a resolved entry that is currently disabled (e.g. a profile entry toggled off).
    // Reuse it so the entry keeps its source; without an explicit config, keep its profile configuration too.
    const existing = this.resolved.plugins.find(entry => entry.name === name);
    const explicitConfig = config !== undefined;
    const effectiveConfig = explicitConfig ? config : existing?.config;
    const fiber = this.root.plugin(definition, effectiveConfig);

    // LIFO undo operations for everything registered below, run only if the settle/start pass throws.
    const undo: (() => void)[] = [];
    try {
      const overlay = isPlainObject(config) ? config : {};
      const resolvedSource = existing ? existing.source : source;
      if (existing) {
        const previous = { disabled: existing.disabled, config: existing.config };
        existing.disabled = false;
        if (explicitConfig) existing.config = overlay;
        undo.push(() => {
          existing.disabled = previous.disabled;
          existing.config = previous.config;
        });
      } else {
        const entry = { name, source, config: overlay, disabled: false };
        if (position && position.resolved >= 0) this.resolved.plugins.splice(position.resolved, 0, entry);
        else this.resolved.plugins.push(entry);
        undo.push(() => {
          const index = this.resolved.plugins.indexOf(entry);
          if (index >= 0) this.resolved.plugins.splice(index, 1);
        });
      }

      const record: InternalRecord = {
        name,
        source: resolvedSource,
        definition: fiber.definition,
        config: fiber.config,
        get state() {
          return fiber.state;
        },
        get context() {
          return fiber.context;
        },
        get error() {
          return fiber.error;
        },
        fiber
      };
      if (position && position.records >= 0) this.records.splice(position.records, 0, record);
      else this.records.push(record);
      undo.push(() => {
        const index = this.records.indexOf(record);
        if (index >= 0) this.records.splice(index, 1);
      });

      await this.enqueueSettle();
    } catch (error) {
      // Roll back the registrations in reverse, then unload the fiber the kernel already registered, so no part of the
      // failed mount lingers. The original error is the meaningful one and is rethrown unchanged.
      for (let index = undo.length - 1; index >= 0; index -= 1) undo[index]();
      try {
        await fiber.dispose();
      } catch {
        // A dispose error must not mask the mount failure.
      }
      throw error;
    }
    return fiber;
  }

  /**
   * Runs `operation` as one job on the mutation chain, so install/uninstall/reload bodies never interleave. A failed
   * job does not break the chain: later jobs still run, and the failure reaches its caller through the returned
   * promise.
   */
  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(operation, operation);
    this.mutationChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** Guards a runtime install/uninstall/reload: it needs a host that has loaded and not been disposed. */
  private assertLoaded(operation: string): void {
    if (this.disposed) throw new Error("PluginHost has been disposed");
    if (!this.loaded) throw new Error(`PluginHost.${operation}() requires load() to have been called first`);
  }

  /**
   * Serializes a settle pass onto the host's chain. A request that arrives while a job is in flight coalesces into it
   * and sets `pendingPass`, so the job runs one more pass before resolving; this keeps a start triggered by a late
   * service change from being dropped. The returned promise reflects the (possibly extended) job, and thus rejects on
   * a fatal error even when coalesced.
   */
  private enqueueSettle(): Promise<void> {
    if (this.current) {
      this.pendingPass = true;
      return this.current;
    }

    const run = async (): Promise<void> => {
      try {
        do {
          this.pendingPass = false;
          await this.settle();
        } while (this.pendingPass && !this.disposed);
      } finally {
        this.current = null;
      }
    };

    const job = this.chain.then(run, run);
    this.current = job;
    // Keep the chain alive after a failed job so later jobs still run; the failure reaches callers through `job`.
    this.chain = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  /**
   * Kernel settle observer: a runtime service change can activate (or re-activate) plugins without any caller
   * promise, so run the host's start-to-fixed-point loop in response. Serialized through `enqueueSettle`, so it
   * coalesces with an in-flight settle. A fatal error is recorded on the manager and surfaced via `fatalError` /
   * `dumpConfig`, so it must not become an unhandled rejection here.
   */
  private handleFibersSettled = (): void => {
    if (this.disposed) return;
    void this.enqueueSettle().catch(() => {
      // Deliberately empty: the fatal is observable through `fatalError` and the dump.
    });
  };

  /**
   * Drives the tree to a fixed point by alternating kernel reconciliation with starting every active plugin that has
   * not started in its current activation. A `start` may `provide` a service that activates a further plugin, so the
   * pair repeats until neither pass changes anything.
   */
  private async settle(): Promise<void> {
    let changed = true;
    while (changed && !this.disposed) {
      await this.root.fibers.settle();
      changed = await this.startPending();
    }
  }

  /**
   * Calls `start` once for every active plugin that has not started in its current activation, in load order.
   * Returns whether it started any plugin, so `settle` can retry reconciliation afterwards.
   */
  private async startPending(): Promise<boolean> {
    let started = false;
    for (const record of this.records) {
      const fiber = record.fiber;
      if (fiber.state !== "active" || fiber.started) continue;
      fiber.markStarted();
      started = true;
      try {
        await fiber.definition.start?.(fiber.context, fiber.config);
      } catch (error) {
        fiber.markError(error);
        if (this.failureMode === "fatal") {
          this.root.fibers.recordFatal(error);
          throw error;
        }
      }
    }
    return started;
  }

  /**
   * Serializes the effective plugin tree to YAML: each resolved entry reports its source, disabled flag, dump state,
   * and effective config, followed by configuration warnings and lifecycle warnings (disabled entries, error states,
   * plugins left pending on missing required services, and any unrecovered fatal error). Output is deterministic for
   * golden comparison.
   */
  dumpConfig(): string {
    if (this.disposed) throw new Error("PluginHost has been disposed");

    const byName = new Map(this.records.map(record => [record.name, record]));
    const plugins = this.resolved.plugins.map(entry => {
      const record = byName.get(entry.name);
      // A disabled entry is never mounted, so it reports the dump-only "disabled" label rather than a lifecycle state.
      const state: PluginDumpState = entry.disabled ? "disabled" : record?.state ?? "pending";
      const plugin: Record<string, unknown> = {
        name: entry.name,
        source: entry.source,
        disabled: entry.disabled,
        state,
        config: sortKeysDeep(record ? record.config : entry.config)
      };
      // Optional dependencies never gate activation, so a mounted plugin that declares any reports their current
      // availability explicitly; this is how an optional service appearing or disappearing becomes observable.
      const optional = record?.fiber.optionalAvailable;
      if (optional && Object.keys(optional).length > 0) plugin.optional = optional;
      return plugin;
    });

    const document = { plugins, warnings: [...this.resolved.warnings, ...this.lifecycleWarnings()] };
    return dump(document, { noRefs: true, lineWidth: -1 });
  }

  private lifecycleWarnings(): string[] {
    const warnings: string[] = [];

    for (const entry of this.resolved.plugins) {
      if (entry.disabled) warnings.push(`plugin "${entry.name}" is disabled and was not loaded`);
    }

    for (const record of this.records) {
      if (record.state === "error") {
        warnings.push(`plugin "${record.name}" is in error state: ${describeError(record.error)}`);
      } else if (record.state === "pending") {
        const missing = record.fiber.missingRequired();
        if (missing.length > 0) {
          warnings.push(`plugin "${record.name}" is pending, missing required service(s): ${missing.join(", ")}`);
        }
      }
    }

    // A fatal error stops the load/reconcile that produced it; surface it so a dump reflects the broken tree.
    const fatal = this.fatalError;
    if (fatal !== null) {
      warnings.push(`plugin host has an unrecovered fatal error: ${describeError(fatal)}`);
    }

    return warnings;
  }
}
