import { dump } from "js-yaml";
import { resolveConfig, type ConfigLayer, type PluginSource, type ResolvedConfig } from "./config";
import { Context } from "./context";
import { sortKeysDeep, type PluginDumpState } from "./dump";
import type { Fiber } from "./fiber";
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

  /** Disposes every plugin in reverse load order, then the root context (clearing the shared service scope). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Let any in-flight settle observe `disposed` and stop before contexts are torn down.
    await this.chain;

    await this.root.fibers.dispose();
    await this.root.dispose();
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
