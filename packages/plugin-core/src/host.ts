import { dump } from "js-yaml";
import { resolveConfig, type ConfigLayer, type PluginSource, type ResolvedConfig } from "./config";
import { Context } from "./context";
import { sortKeysDeep, type PluginDumpState } from "./dump";
import { deepMerge } from "./object";
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The composition root for a plugin tree. It resolves an ordered plugin list from a layered configuration, loads each
 * enabled plugin through a {@link ModuleResolver}, and drives the lifecycle state machine while gating activation on
 * declared `inject.required` dependencies.
 *
 * Reconciliation is serialized through a single promise chain: a service change enqueues one job, and a job runs the
 * reconcile pass repeatedly until no state changes. This makes re-entrant changes (a plugin's `apply` providing a
 * service, a deactivation revoking one) settle without concurrent passes.
 */
export class PluginHost {
  readonly root: Context;

  private readonly options: PluginHostOptions;
  private readonly failureMode: "skip" | "fatal";
  private readonly records: PluginRecord[] = [];
  private readonly started = new Set<string>();
  private resolved: ResolvedConfig = { plugins: [], warnings: [] };
  private loaded = false;
  private disposed = false;
  private chain: Promise<void> = Promise.resolve();
  private current: Promise<void> | null = null;
  private queued = false;
  private fatal: unknown = null;
  private readonly reportedErrors = new WeakSet<object>();

  constructor(options: PluginHostOptions) {
    this.options = options;
    this.failureMode = options.failureMode ?? "skip";
    this.root = new Context();
  }

  /** The tracked plugin records, in load order. Disabled entries are not loaded and thus not listed. */
  get plugins(): readonly PluginRecord[] {
    return this.records;
  }

  /**
   * The first fatal `apply`/`start` error, or `null`. Fatal mode rejects the triggering `load`/`reconcile` promise;
   * this accessor keeps the error observable afterwards (including for reconciles triggered by external service
   * changes, which have no promise the caller awaited).
   */
  get fatalError(): unknown {
    return this.fatal;
  }

  /**
   * Resolves `layers`, loads every enabled plugin, and runs the tree to a fixed point: dependencies are reconciled
   * and every active plugin is started, repeatedly, until a `start` that provides a service can no longer activate a
   * further plugin. Resolves only once no activation or start remains pending.
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

    for (const entry of this.resolved.plugins) {
      if (entry.disabled) continue;

      const definition = await this.options.resolver.resolve(entry.name);
      const merged = deepMerge(definition.config?.defaults ?? {}, entry.config);
      const config = definition.config?.parse ? definition.config.parse(merged) : merged;
      const context = this.root.fork(entry.name, config);

      this.records.push({
        name: entry.name,
        source: entry.source,
        definition,
        config,
        state: "pending",
        context,
        error: undefined
      });
    }

    // Observe the tree-wide scope before reconciling so activations re-trigger dependency gating.
    this.root.onServiceChange(this.handleServiceChange);

    await this.reconcile();
  }

  /**
   * Runs dependency reconciliation and start to a fixed point; resolves once the tree is stable again. Rejects with
   * the offending error when `failureMode` is `"fatal"`.
   */
  reconcile(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.enqueueReconcile();
  }

  /** Disposes every plugin in reverse load order, then the root context (clearing the shared service scope). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Let any in-flight reconcile observe `disposed` and stop before contexts are torn down.
    await this.chain;

    for (const record of [...this.records].reverse()) {
      if (record.context.disposed) {
        record.state = "disposed";
        continue;
      }
      record.state = "disposing";
      await record.context.dispose();
      record.state = "disposed";
    }

    await this.root.dispose();
  }

  /**
   * Serializes a settle pass onto the host's chain, coalescing requests that arrive while one is pending. The
   * returned promise reflects the in-flight pass (and thus rejects on a fatal error) even when coalesced.
   */
  private enqueueReconcile(): Promise<void> {
    if (this.queued && this.current) return this.current;
    this.queued = true;

    const run = async (): Promise<void> => {
      try {
        await this.settle();
      } catch (error) {
        // Record the fatal here too, so an error that bypassed activate/start is still observable.
        if (this.fatal === null) this.fatal = error;
        throw error;
      } finally {
        this.queued = false;
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

  private handleServiceChange = (): void => {
    if (this.disposed) return;
    void this.enqueueReconcile().catch((error: unknown) => {
      // An externally triggered reconcile has no caller promise to surface its failure, so it must not be swallowed:
      // record the fatal and report it. `activate`/`start` already report the failing plugin by name, so a duplicate
      // report for the same error object is suppressed.
      if (this.fatal === null) this.fatal = error;
      this.reportError("<service-change>", error);
    });
  };

  /**
   * Drives the tree to a fixed point by alternating dependency reconciliation with starting every active plugin that
   * has not started in its current activation. A `start` may `provide` a service that activates a further plugin, so
   * the pair repeats until neither pass changes anything.
   */
  private async settle(): Promise<void> {
    let changed = true;
    while (changed && !this.disposed) {
      const reconciled = await this.reconcileStable();
      const started = await this.startPending();
      changed = reconciled || started;
    }
  }

  private async reconcileStable(): Promise<boolean> {
    let changed = false;
    let passChanged = true;
    while (passChanged && !this.disposed) {
      passChanged = await this.reconcilePass();
      if (passChanged) changed = true;
    }
    return changed;
  }

  /**
   * One reconcile pass: deactivate every active plugin whose required services vanished, then activate every pending
   * plugin whose required services are present. Returns whether any plugin changed state, so the caller can repeat
   * until stable.
   */
  private async reconcilePass(): Promise<boolean> {
    if (this.disposed) return false;
    let changed = false;

    for (const record of this.records) {
      if (record.state === "active" && this.missingRequired(record).length > 0) {
        await this.deactivate(record);
        changed = true;
      }
    }

    for (const record of this.records) {
      if (record.state !== "pending") continue;
      if (this.missingRequired(record).length > 0) continue;
      await this.activate(record);
      changed = true;
    }

    return changed;
  }

  private missingRequired(record: PluginRecord): string[] {
    const required = record.definition.inject?.required ?? [];
    return required.filter(name => !record.context.has(name));
  }

  private async activate(record: PluginRecord): Promise<void> {
    record.state = "loading";
    try {
      await record.definition.apply(record.context, record.config);
      record.state = "active";
      record.error = undefined;
    } catch (error) {
      // Roll back everything the failed apply registered, then record the failure.
      try {
        await record.context.dispose();
      } catch {
        // The original apply error is the meaningful one; a rollback error must not mask it.
      }
      record.state = "error";
      record.error = error;
      this.reportError(record.name, error);
      if (this.failureMode === "fatal") {
        if (this.fatal === null) this.fatal = error;
        throw error;
      }
    }
  }

  private async deactivate(record: PluginRecord): Promise<void> {
    record.state = "disposing";
    await record.context.dispose();
    // A fresh context is ready if the dependency returns later.
    record.context = this.root.fork(record.name, record.config);
    record.state = "pending";
    // Remembering that this activation already started would suppress `start` on the next activation.
    this.started.delete(record.name);
  }

  /**
   * Calls `start` once for every active plugin that has not started in its current activation, in load order.
   * Returns whether it started any plugin, so `settle` can retry reconciliation afterwards.
   */
  private async startPending(): Promise<boolean> {
    let started = false;
    for (const record of this.records) {
      if (record.state !== "active") continue;
      if (this.started.has(record.name)) continue;
      this.started.add(record.name);
      started = true;
      try {
        await record.definition.start?.(record.context, record.config);
      } catch (error) {
        record.state = "error";
        record.error = error;
        this.reportError(record.name, error);
        if (this.failureMode === "fatal") {
          if (this.fatal === null) this.fatal = error;
          throw error;
        }
      }
    }
    return started;
  }

  /** Invokes `onError` at most once per distinct thrown error, so a fatal is reported a single time. */
  private reportError(name: string, error: unknown): void {
    if (typeof error === "object" && error !== null) {
      if (this.reportedErrors.has(error)) return;
      this.reportedErrors.add(error);
    }
    this.options.onError?.(name, error);
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
      return {
        name: entry.name,
        source: entry.source,
        disabled: entry.disabled,
        state,
        config: sortKeysDeep(record ? record.config : entry.config)
      };
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
        const missing = this.missingRequired(record);
        if (missing.length > 0) {
          warnings.push(`plugin "${record.name}" is pending, missing required service(s): ${missing.join(", ")}`);
        }
      }
    }

    // A fatal error stops the load/reconcile that produced it; surface it so a dump reflects the broken tree.
    if (this.fatal !== null) {
      warnings.push(`plugin host has an unrecovered fatal error: ${describeError(this.fatal)}`);
    }

    return warnings;
  }
}
