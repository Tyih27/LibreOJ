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
 * The single service container shared by one plugin tree. The root context creates it and every descendant reuses the
 * same instance, so a service provided anywhere in the tree is visible to all contexts in that tree — ancestors,
 * descendants, and siblings alike — independent of mount order. Distinct root contexts get distinct scopes and never
 * share services. Only one live provider may hold a given name at a time; a second `provide` for that name throws.
 */
export class ServiceScope {
  private readonly services = new Map<string, unknown>();
  private readonly listeners = new Set<ServiceChangeListener>();

  /** Binds `name` to `value`, rejecting a name that already has a live provider. The returned disposer removes it. */
  provide(name: string, value: unknown): Disposer {
    if (this.services.has(name)) throw new Error(`Service "${name}" is already provided in this scope`);
    this.services.set(name, value);
    this.notify();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.services.delete(name)) this.notify();
    };
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  get(name: string): unknown {
    return this.services.get(name);
  }

  /** Removes every service, notifying once if anything was present. Idempotent. */
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

  private notify(): void {
    // Snapshot so a listener may register or remove listeners while notifying.
    //
    // Each listener is isolated: a throwing observer must not stop the remaining observers and must never escape into
    // `provide`/`clear`. If it escaped, `provide` would register the service and then throw before its disposer is
    // returned (leaking the service until the root is cleared), and `clear` would abort partway. The error is
    // deliberately swallowed per listener for that reason; the exception is not rethrown here.
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Ignored on purpose: one faulty observer cannot break service mutation or the other observers.
      }
    }
  }
}
