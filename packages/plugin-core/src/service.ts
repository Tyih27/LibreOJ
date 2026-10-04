import type { Disposer } from "./disposable";

/**
 * The minimal context surface a `Service` needs to register itself. Declared structurally so the base class does not
 * import `Context`, which would create a runtime cycle.
 */
interface ServiceContext {
  set(name: string, value: unknown): void;
}

/**
 * Cordis-style service base class. Constructing it registers `this` under `name` on the context, so subclasses are
 * written as `class Db extends Service { constructor(ctx) { super(ctx, "db"); } }`. The binding is revoked by the
 * context's disposal, exactly like `ctx.set`.
 */
export class Service {
  constructor(ctx: ServiceContext, name: string) {
    ctx.set(name, this);
  }
}

/** Notified whenever a service is added to or removed from a scope. */
export type ServiceChangeListener = () => void;

/**
 * A service container. One root scope is shared by a whole plugin tree, so a service provided anywhere in the tree is
 * visible to all contexts in that tree — ancestors, descendants, and siblings alike — independent of mount order.
 * Distinct root scopes never share services. Only one live provider may hold a given name within one scope; a second
 * `provide` for that name in that scope throws.
 *
 * An isolate scope hangs off its parent and owns a set of names exclusively: for an isolated name lookup stops at the
 * isolating scope instead of walking to the parent, so the name is invisible on both sides of the boundary. Names a
 * scope does not isolate resolve exactly as before, up to the root; every other service stays tree-global.
 */
export class ServiceScope {
  /** The enclosing scope, or `null` for the root. An isolate scope points at the scope it was created from. */
  readonly parent: ServiceScope | null;

  private readonly services = new Map<string, unknown>();
  private readonly listeners = new Set<ServiceChangeListener>();
  /** Names this scope owns exclusively: a lookup for one of them stops here instead of reaching `parent`. */
  private readonly isolated: ReadonlySet<string>;

  constructor(parent: ServiceScope | null = null, isolated: Iterable<string> = []) {
    this.parent = parent;
    this.isolated = new Set(isolated);
  }

  /**
   * The scope that owns `name`: this scope when it isolates `name`, otherwise the nearest ancestor that does, falling
   * back to the root. This keeps an isolated name from leaking across its boundary while every other name resolves
   * tree-globally.
   */
  resolveScope(name: string): ServiceScope {
    if (this.isolated.has(name)) return this;
    return this.parent ? this.parent.resolveScope(name) : this;
  }

  /**
   * Binds `name` to `value` in the scope that owns it, rejecting a name that already has a live provider in that
   * scope. The returned disposer removes it.
   */
  provide(name: string, value: unknown): Disposer {
    const scope = this.resolveScope(name);
    if (scope.services.has(name)) throw new Error(`Service "${name}" is already provided in this scope`);
    scope.services.set(name, value);
    scope.notify();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (scope.services.delete(name)) scope.notify();
    };
  }

  has(name: string): boolean {
    return this.resolveScope(name).services.has(name);
  }

  get(name: string): unknown {
    return this.resolveScope(name).services.get(name);
  }

  /** Removes every service this scope owns locally, notifying once if anything was present. Idempotent. */
  clear(): void {
    if (this.services.size === 0) return;
    this.services.clear();
    this.notify();
  }

  /** Registers a change listener; the returned disposer detaches it. */
  onChange(listener: ServiceChangeListener): Disposer {
    this.listeners.add(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  /**
   * Notifies this scope's listeners and then each ancestor's, walking upward. A listener registered on several scopes
   * (as `Context.onServiceChange` does) runs once per change, while a change deep in an isolated subtree still reaches
   * an ancestor subscriber such as the root's FiberManager.
   */
  private notify(): void {
    // Snapshot per scope so a listener may register or remove listeners while notifying.
    //
    // Each listener is isolated: a throwing observer must not stop the remaining observers and must never escape into
    // `provide`/`clear`. If it escaped, `provide` would register the service and then throw before its disposer is
    // returned (leaking the service until the root is cleared), and `clear` would abort partway. The error is
    // deliberately swallowed per listener for that reason; the exception is not rethrown here.
    const notified = new Set<ServiceChangeListener>();
    for (let scope: ServiceScope | null = this; scope; scope = scope.parent) {
      for (const listener of [...scope.listeners]) {
        if (notified.has(listener)) continue;
        notified.add(listener);
        try {
          listener();
        } catch {
          // Ignored on purpose: one faulty observer cannot break service mutation or the other observers.
        }
      }
    }
  }
}
