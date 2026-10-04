import { DisposableStack, type Disposer } from "./disposable";
import { EventBus, type Listener } from "./events";
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
   * Registers a service in the tree-wide scope, visible to every context in the tree. A duplicate live name anywhere
   * in the tree is rejected. The binding is revoked when this context is disposed.
   */
  provide(name: string, value: unknown): void {
    this.assertActive();
    this.stack.add(this.serviceScope.provide(name, value));
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

  /** Registers a listener whose lifetime is bound to this context. */
  on(event: string, listener: Listener): Disposer {
    this.assertActive();
    return this.stack.add(this.events.on(event, listener));
  }

  /** Emits an event to this context's listeners, then to each ancestor's, deepest first. */
  emit(event: string, ...args: unknown[]): void {
    this.assertActive();
    for (let ctx: Context | null = this; ctx; ctx = ctx.parent) {
      ctx.events.emit(event, ...args);
    }
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
