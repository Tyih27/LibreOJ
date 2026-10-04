import type { Context } from "./context";
import type { Disposer } from "./disposable";
import type { PluginDefinition, PluginState } from "./plugin";

/** Kernel-level lifecycle policy, mirrored by `PluginHostOptions` and forwarded to the root's manager. */
export interface FiberManagerOptions {
  /** What to do when an `apply` throws: skip and record, or fail the reconciliation. Defaults to `"skip"`. */
  failureMode?: "skip" | "fatal";
  /** Called at most once per distinct thrown error, with the plugin name that produced it. */
  onError?: (name: string, error: unknown) => void;
}

/**
 * One mounted plugin = one fiber. The kernel owns its lifecycle and dependency gate: `pending` until every
 * `inject.required` service is present, then `loading → active`; if a required service vanishes the fiber
 * `disposing → pending` from a freshly forked context. An `apply` that throws rolls its context back and lands in
 * `error`. `dispose()` unloads the plugin at runtime and lets the kernel re-evaluate its dependents.
 */
export class Fiber {
  readonly name: string;
  readonly definition: PluginDefinition;
  readonly config: Record<string, unknown>;

  private readonly manager: FiberManager;
  /** The context `plugin()` was called on; a deactivation re-forks this to get a clean context. */
  private readonly parent: Context;
  private currentContext: Context;
  private currentState: PluginState = "pending";
  private currentError: unknown = undefined;
  private startedFlag = false;

  constructor(
    manager: FiberManager,
    parent: Context,
    context: Context,
    definition: PluginDefinition,
    config: Record<string, unknown>
  ) {
    this.manager = manager;
    this.parent = parent;
    this.currentContext = context;
    this.definition = definition;
    this.config = config;
    this.name = definition.name;
  }

  /** The current lifecycle state. */
  get state(): PluginState {
    return this.currentState;
  }

  /** The plugin's current context; rebuilt whenever the plugin is deactivated and re-activated. */
  get context(): Context {
    return this.currentContext;
  }

  /** The error an `apply`/`start` threw, when the fiber is in `error`. */
  get error(): unknown {
    return this.currentError;
  }

  /** Whether `start` already ran for the current activation. Reset on deactivation. */
  get started(): boolean {
    return this.startedFlag;
  }

  /** The required services this fiber still lacks, evaluated against its live context. */
  missingRequired(): string[] {
    const required = this.definition.inject?.required ?? [];
    return required.filter(name => !this.currentContext.has(name));
  }

  /**
   * The declared optional services that are currently unavailable in this fiber's scope. Optional dependencies never
   * gate activation, so this is diagnostic only: it lets an observer watch an optional service appear and disappear.
   */
  missingOptional(): string[] {
    const optional = this.definition.inject?.optional ?? [];
    if (this.currentContext.disposed) return [...optional];
    return optional.filter(name => !this.currentContext.has(name));
  }

  /**
   * For each declared optional dependency, whether it is currently resolvable in this fiber's scope. Optional
   * dependencies never gate activation (unlike `required`); this exposes their state so diagnostics (and the host
   * dump) can observe them appearing and disappearing. Once the context is gone every entry is `false`.
   */
  get optionalAvailable(): Record<string, boolean> {
    const optional = this.definition.inject?.optional ?? [];
    const live = !this.currentContext.disposed;
    const available: Record<string, boolean> = {};
    for (const name of optional) available[name] = live ? this.currentContext.has(name) : false;
    return available;
  }

  /** Runs `apply` on a satisfied fiber. A throw rolls the context back and records `error` (or rethrows if fatal). */
  async activate(): Promise<void> {
    this.currentState = "loading";
    this.startedFlag = false;
    try {
      await this.definition.apply(this.currentContext, this.config);
      this.currentState = "active";
      this.currentError = undefined;
      // Lifecycle event: emitted on the plugin's own context, so it bubbles to the mounting context and ancestors.
      this.currentContext.emit("ready");
    } catch (error) {
      // Roll back everything the failed apply registered before reporting it.
      try {
        await this.currentContext.dispose();
      } catch {
        // The original apply error is the meaningful one; a rollback error must not mask it.
      }
      this.currentState = "error";
      this.currentError = error;
      this.manager.reportError(this.name, error);
      if (this.manager.failureMode === "fatal") {
        this.manager.recordFatal(error);
        throw error;
      }
    }
  }

  /** Disposes the active context and rebuilds a fresh one, so a returning dependency can re-activate the fiber. */
  async deactivate(): Promise<void> {
    this.currentState = "disposing";
    // Pair the `ready` that a successful activation emitted with a `dispose` before this context is torn down.
    if (!this.currentContext.disposed) this.currentContext.emit("dispose");
    await this.currentContext.dispose();
    this.currentContext = this.parent.fork(this.name, this.config);
    this.currentState = "pending";
    // A fresh activation must run `start` again.
    this.startedFlag = false;
  }

  /** Records that `start` ran for the current activation. */
  markStarted(): void {
    this.startedFlag = true;
  }

  /** Records a `start` failure (the host owns `start`, so it reports the failure through this method). */
  markError(error: unknown): void {
    this.currentState = "error";
    this.currentError = error;
    this.manager.reportError(this.name, error);
  }

  /**
   * Unloads the plugin at runtime: removes it from the kernel, disposes its context, and lets the manager
   * re-evaluate dependents. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.currentState === "disposed") return;

    this.manager.remove(this);
    this.currentState = "disposing";
    if (!this.currentContext.disposed) {
      // Lifecycle event: emitted before the context is torn down, so listeners can still observe a live context.
      this.currentContext.emit("dispose");
      await this.currentContext.dispose();
    }
    this.currentState = "disposed";
    this.manager.scheduleReconcile();
  }
}

/**
 * The kernel's fiber registry, owned by the root context and shared by the whole tree. It subscribes to the tree-wide
 * service scope and reconciles to a fixed point: first deactivate every active fiber whose required services vanished,
 * then activate every pending fiber whose required services are now present. Reconciliation is serialized on one
 * promise chain, so a service change raised while a pass is running is absorbed by that pass instead of racing it.
 */
export class FiberManager {
  private readonly fibers: Fiber[] = [];
  private mode: "skip" | "fatal" = "skip";
  private onErrorCallback: ((name: string, error: unknown) => void) | undefined;
  private fatal: unknown = null;
  private disposed = false;
  private chain: Promise<void> = Promise.resolve();
  private current: Promise<void> | null = null;
  /** Set when a request arrives while a pass is in flight, forcing one more pass before the job resolves. */
  private pendingPass = false;
  private readonly reportedErrors = new WeakSet<object>();
  private readonly settledListeners = new Set<() => void>();

  constructor(root: Context) {
    // Observe the tree-wide scope before the first mount, so activations re-trigger dependency gating.
    root.onServiceChange(this.handleServiceChange);
  }

  /** The mounted fibers, in mount order. */
  get list(): readonly Fiber[] {
    return this.fibers;
  }

  /** The first fatal error, or `null`. */
  get fatalError(): unknown {
    return this.fatal;
  }

  /** What a throwing `apply` does: record and continue, or reject the reconciliation. */
  get failureMode(): "skip" | "fatal" {
    return this.mode;
  }

  /** Applies lifecycle policy. Called by `PluginHost`; the kernel defaults to `"skip"` with no error callback. */
  configure(options: FiberManagerOptions): void {
    if (options.failureMode) this.mode = options.failureMode;
    if (options.onError) this.onErrorCallback = options.onError;
  }

  /** Registers a freshly mounted fiber and schedules a reconciliation. */
  register(fiber: Fiber): void {
    this.fibers.push(fiber);
    this.scheduleReconcile();
  }

  /** Removes a fiber from the registry. */
  remove(fiber: Fiber): void {
    const index = this.fibers.indexOf(fiber);
    if (index >= 0) this.fibers.splice(index, 1);
  }

  /** Schedules a reconciliation that no caller awaits; a failure is recorded and reported. */
  scheduleReconcile(): void {
    if (this.disposed) return;
    void this.enqueue().catch((error: unknown) => {
      this.recordFatal(error);
      this.reportError("<service-change>", error);
    });
  }

  /** Reconciles to a fixed point; rejects with the offending error when a fatal activation fails. */
  settle(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.enqueue();
  }

  /**
   * Subscribes to reconciliation outcomes: `listener` runs after a reconcile job settles to a fixed point **and that
   * job changed at least one fiber's state** (activated or deactivated). A job that only observed an already-stable
   * tree does not notify, so a listener that schedules another pass converges instead of looping. The returned
   * disposer detaches it; all listeners are dropped when the manager is disposed.
   */
  onSettled(listener: () => void): Disposer {
    if (this.disposed) throw new Error("FiberManager has been disposed");
    this.settledListeners.add(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.settledListeners.delete(listener);
    };
  }

  /** Records the first fatal error so it stays observable after the rejecting promise is gone. */
  recordFatal(error: unknown): void {
    if (this.fatal === null) this.fatal = error;
  }

  /** Invokes `onError` at most once per distinct thrown error, so a fatal is reported a single time. */
  reportError(name: string, error: unknown): void {
    if (typeof error === "object" && error !== null) {
      if (this.reportedErrors.has(error)) return;
      this.reportedErrors.add(error);
    }
    this.onErrorCallback?.(name, error);
  }

  /** Disposes every fiber in reverse mount order. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.settledListeners.clear();
    await this.chain;

    for (const fiber of [...this.fibers].reverse()) {
      if (fiber.state === "disposed") continue;
      await fiber.dispose();
    }
    this.fibers.length = 0;
  }

  private handleServiceChange = (): void => {
    this.scheduleReconcile();
  };

  /**
   * Serializes reconciliation on the chain. A request that arrives while a job is in flight coalesces into it and
   * sets `pendingPass`, so the job runs at least one more pass after its current one; this guarantees the request is
   * never dropped in the window between a pass finishing and its job resolving. The returned promise reflects the
   * (possibly extended) in-flight job, and thus rejects on a fatal error even when coalesced.
   */
  private enqueue(): Promise<void> {
    if (this.current) {
      this.pendingPass = true;
      return this.current;
    }

    const run = async (): Promise<void> => {
      let changed = false;
      try {
        do {
          this.pendingPass = false;
          if (await this.reconcileStable()) changed = true;
        } while (this.pendingPass && !this.disposed);
      } catch (error) {
        // Record the fatal here too, so an error that bypassed activate is still observable.
        this.recordFatal(error);
        throw error;
      } finally {
        // Clear `current` before notifying, so a listener that schedules a fresh reconcile is not coalesced into
        // this already-finished job.
        this.current = null;
      }
      if (changed) this.notifySettled();
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

  /** Reconciles repeatedly until a full pass changes nothing; returns whether any pass changed a fiber's state. */
  private async reconcileStable(): Promise<boolean> {
    let changed = true;
    let any = false;
    while (changed && !this.disposed) {
      changed = await this.reconcilePass();
      if (changed) any = true;
    }
    return any;
  }

  /** Notifies settle listeners, isolating each so a throwing listener cannot break the others or the manager. */
  private notifySettled(): void {
    if (this.disposed) return;
    for (const listener of [...this.settledListeners]) {
      try {
        listener();
      } catch {
        // Ignored on purpose: a settle observer must not escape into the reconcile job.
      }
    }
  }

  private async reconcilePass(): Promise<boolean> {
    if (this.disposed) return false;
    let changed = false;

    for (const fiber of [...this.fibers]) {
      if (fiber.state === "active" && fiber.missingRequired().length > 0) {
        await fiber.deactivate();
        changed = true;
      }
    }

    for (const fiber of [...this.fibers]) {
      if (fiber.state === "pending" && fiber.missingRequired().length === 0) {
        await fiber.activate();
        changed = true;
      }
    }

    return changed;
  }
}
