import { DisposableStack, type Disposer } from "./disposable";
import { EventBus, type Listener } from "./events";
import { Fiber, FiberManager } from "./fiber";
import { deepMerge, isPlainObject } from "./object";
import { normalizePlugin, type PluginInput } from "./plugin";
import { ServiceScope, type ServiceChangeListener } from "./service";
import { RegistryCell, ReversibleRegistry } from "./registry";

/**
 * A layered runtime handle. A context owns event listeners, effects, child contexts, and reversible registries; all of
 * them are torn down in reverse when the context is disposed.
 *
 * - Services live in one `ServiceScope` shared by the whole tree: the root creates it and every descendant reuses it,
 *   so `provide` from any context is visible to every context in the tree (including siblings) and lookup never walks
 *   the parent chain. Duplicate live `provide` of a name anywhere in the tree throws. The scope is cleared when the
 *   root is disposed; an ancestor/descendant split (`isolate`) is not implemented, though `fork` keeps the parent link.
 * - `emit` bubbles upward only: the deepest context's listeners run first, then each ancestor's.
 * - `registry` returns a handle bound to this context over a namespace's shared cell; the cell itself is always
 *   created on and owned by the root context, so the whole tree shares one store.
 */
export class Context {
  readonly parent: Context | null;
  readonly scope: string;
  readonly config: Record<string, unknown>;

  private readonly serviceScope: ServiceScope;
  private readonly events = new EventBus();
  private readonly stack = new DisposableStack();
  private readonly children: Context[] = [];
  private readonly registries = new Map<string, ReversibleRegistry<unknown>>();
  private readonly cells = new Map<string, RegistryCell<unknown>>();
  private fiberManager: FiberManager | null = null;
  private isDisposed = false;

  constructor(parent: Context | null = null, scope = "root", config: Record<string, unknown> = {}) {
    this.parent = parent;
    this.scope = scope;
    this.config = { ...config };
    // The root owns the tree's service scope; every descendant reuses its parent's.
    this.serviceScope = parent ? parent.serviceScope : new ServiceScope();
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Creates a child context that is disposed together with (and before) this one. */
  fork(scope: string, config: Record<string, unknown> = {}): Context {
    this.assertActive();
    const child = new Context(this, scope, config);
    this.children.push(child);
    return child;
  }

  /**
   * The kernel's fiber manager, owned by the root context and shared by the whole tree. It is created lazily on the
   * root, so `ctx.plugin` works without a host while still giving every context one registry.
   */
  get fibers(): FiberManager {
    this.assertActive();
    const root = this.rootContext();
    if (!root.fiberManager) root.fiberManager = new FiberManager(root);
    return root.fiberManager;
  }

  /**
   * Mounts a plugin as a {@link Fiber} under this context and returns it. The definition's `config.defaults` are
   * overlaid with `config`, then validated by `config.parse`; the fiber receives a child context forked from this one.
   * The kernel gates activation on `inject.required` and reconciles asynchronously, so a gated plugin may still be
   * `pending` when this returns.
   */
  plugin(input: PluginInput, config?: unknown): Fiber {
    this.assertActive();
    const definition = normalizePlugin(input);
    const overlay = isPlainObject(config) ? config : {};
    const merged = deepMerge(definition.config?.defaults ?? {}, overlay);
    const finalConfig = (definition.config?.parse ? definition.config.parse(merged) : merged) as Record<
      string,
      unknown
    >;

    const manager = this.fibers;
    const context = this.fork(definition.name, finalConfig);
    const fiber = new Fiber(manager, this, context, definition, finalConfig);
    manager.register(fiber);

    // A sub-plugin lives exactly as long as the context that mounted it.
    this.effect(() => () => {
      void fiber.dispose();
    });
    return fiber;
  }

  /**
   * Runs `cb` while every name in `deps` is present in the tree-wide scope, and registers the disposer it returns.
   * When the set of available dependencies changes so that it is no longer satisfied, `cb`'s registration is undone;
   * when it is satisfied again, `cb` runs again. Both the dependency subscription and the current registration are
   * revoked when this context is disposed (or when the returned disposer is called).
   */
  inject(deps: string[], cb: () => void | Disposer): Disposer {
    this.assertActive();
    const required = [...deps];
    let current: Disposer | null = null;
    let active = true;

    const evaluate = (): void => {
      if (!active) return;
      const ready = required.every(name => this.serviceScope.has(name));
      if (ready && !current) {
        // A placeholder blocks a re-entrant service change (raised from inside `cb`) from running it twice.
        current = () => {};
        let result: void | Disposer;
        try {
          result = cb();
        } catch (error) {
          // Drop the placeholder so the next dependency change retries `cb`, and report the failure through the
          // kernel's error hook: the service scope swallows listener exceptions, so failing silently is not an option.
          current = null;
          this.fibers.reportError(this.scope, error);
          return;
        }
        if (typeof result === "function") current = result;
      } else if (!ready && current) {
        const undo = current;
        current = null;
        undo();
      }
    };

    const off = this.onServiceChange(evaluate);
    const detach = (): void => {
      if (!active) return;
      active = false;
      off();
      if (current) {
        const undo = current;
        current = null;
        undo();
      }
    };
    const registered = this.stack.add(detach);
    evaluate();
    return registered;
  }

  /**
   * Registers a service in the tree-wide scope, visible to every context in the tree. A duplicate live name anywhere
   * in the tree is rejected. The binding is revoked when this context is disposed. This is the primary registration
   * method; `provide` is an alias kept for compatibility.
   */
  set(name: string, value: unknown): void {
    this.assertActive();
    this.stack.add(this.serviceScope.provide(name, value));
  }

  /** Alias of `set`, registering a service in the tree-wide scope. */
  provide(name: string, value: unknown): void {
    this.set(name, value);
  }

  /** Resolves a service from the tree-wide scope, throwing when it is not provided. */
  get<T = unknown>(name: string): T {
    this.assertActive();
    if (this.serviceScope.has(name)) return this.serviceScope.get(name) as T;
    throw new Error(`Service "${name}" is not available in scope "${this.scope}"`);
  }

  tryGet<T = unknown>(name: string): T | undefined {
    this.assertActive();
    return this.serviceScope.get(name) as T | undefined;
  }

  has(name: string): boolean {
    this.assertActive();
    return this.serviceScope.has(name);
  }

  /**
   * Subscribes to changes in the tree-wide service scope: `listener` runs whenever any context in the tree provides
   * or removes a service. The returned disposer detaches it, and it is automatically revoked when this context is
   * disposed, so callers never need to reach into the scope directly.
   */
  onServiceChange(listener: ServiceChangeListener): Disposer {
    this.assertActive();
    return this.stack.add(this.serviceScope.onChange(listener));
  }

  /** Registers a normal-tier listener whose lifetime is bound to this context. */
  on(event: string, listener: Listener): Disposer {
    this.assertActive();
    return this.stack.add(this.events.on(event, listener));
  }

  /** Registers a `before`-tier listener: it runs before this context's normal listeners for the event. */
  before(event: string, listener: Listener): Disposer {
    this.assertActive();
    return this.stack.add(this.events.before(event, listener));
  }

  /** Registers an `after`-tier listener: it runs after this context's normal listeners for the event. */
  after(event: string, listener: Listener): Disposer {
    this.assertActive();
    return this.stack.add(this.events.after(event, listener));
  }

  /** Registers a listener that is removed as soon as it first fires. Its lifetime is bound to this context. */
  once(event: string, listener: Listener): Disposer {
    this.assertActive();
    return this.stack.add(this.events.once(event, listener));
  }

  /**
   * Emits an event to this context's listeners, then to each ancestor's, deepest context first. Within one context the
   * `before` tier runs first, then the normal listeners, then `after`. The first listener to return a value other than
   * `undefined` bails: no later listener (including in an ancestor context) runs, and its value is returned.
   */
  emit(event: string, ...args: unknown[]): unknown {
    this.assertActive();
    for (let ctx: Context | null = this; ctx; ctx = ctx.parent) {
      const result = ctx.events.emit(event, ...args);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  /** Runs `fn` immediately and registers the disposer it returns (if any) for teardown. */
  effect(fn: () => void | Disposer): Disposer {
    this.assertActive();
    const result = fn();
    if (typeof result === "function") return this.stack.add(result);
    return () => {};
  }

  /**
   * Returns a handle over the shared storage for `namespace`, bound to this context. A namespace's cell is created on
   * and owned by the root context no matter which context requests it first, so every context in the tree resolves to
   * the same store regardless of request order. Each `set` is reverted on the calling context's disposal.
   */
  registry<T>(namespace: string): ReversibleRegistry<T> {
    this.assertActive();

    const existing = this.registries.get(namespace);
    if (existing) return existing as ReversibleRegistry<T>;

    const root = this.rootContext();
    let cell = root.cells.get(namespace) as RegistryCell<unknown> | undefined;
    if (!cell) {
      cell = new RegistryCell<unknown>();
      root.cells.set(namespace, cell);
      // The root owns the cell's lifetime and tears it down last; descendants only hold non-owning handles.
      const created = cell;
      root.stack.add(() => created.dispose());
    }

    // Registered before any entry disposers, so entries revert first (LIFO) and then the handle detaches.
    const handle = new ReversibleRegistry<T>(disposer => this.stack.add(disposer), cell as RegistryCell<T>, false);
    this.stack.add(() => handle.dispose());
    this.registries.set(namespace, handle as ReversibleRegistry<unknown>);
    return handle;
  }

  /** Tears down children (reverse creation order) then this context's disposers (LIFO). Idempotent. */
  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
    }

    for (const child of [...this.children].reverse()) await child.dispose();

    try {
      this.stack.run();
    } finally {
      this.events.clear();
      // Only the root owns the shared scope; descendants already revoked their own bindings via the stack.
      if (!this.parent) this.serviceScope.clear();
      this.registries.clear();
      this.cells.clear();
    }
  }

  private rootContext(): Context {
    let ctx: Context = this;
    while (ctx.parent) ctx = ctx.parent;
    return ctx;
  }

  private assertActive(): void {
    if (this.isDisposed) throw new Error(`Context "${this.scope}" has been disposed`);
  }
}
