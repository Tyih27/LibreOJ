import type { Disposer } from "./disposable";

/** One write in a key's chain. The opaque id lets a pending revert find and remove its own write. */
export interface RegistryWrite<T> {
  readonly id: symbol;
  readonly value: T;
}

interface RegistryBase<T> {
  readonly has: boolean;
  readonly value?: T;
}

/**
 * The shared backing store for one registry namespace. A cell is created and owned by the root context; every handle
 * bound anywhere in that context tree reads and writes this same store, so registrations are visible across the whole
 * tree. The root's disposal clears the cell.
 *
 * Each key keeps an ordered chain of writes rather than a single previous value. Reverting a write removes its own
 * entry from the chain and recomputes the effective value, which keeps interleaved overwrites correct: a revert never
 * resurrects a value that a later write has superseded, and once the chain empties the key falls back to the base
 * value captured before the chain started (or disappears if there was none).
 */
export class RegistryCell<T> {
  readonly values = new Map<string, T>();
  /** Per-key write chains, oldest first, shared by every handle over this cell. */
  readonly writes = new Map<string, RegistryWrite<T>[]>();
  readonly listeners = new Set<() => void>();
  /** Per-key value that predates a chain, restored when the chain empties. */
  private readonly bases = new Map<string, RegistryBase<T>>();
  private isDisposed = false;

  notify(): void {
    // Snapshot so a listener may register or remove listeners while notifying.
    //
    // Each listener is isolated: a throwing observer must not stop the remaining observers and must never escape into
    // `addWrite`/`remove`/`recompute`. If it escaped, `ReversibleRegistry.set` would append the write and then throw
    // from `addWrite` before `register` records the revert disposer, leaking the write to the root disposal since
    // nothing would ever remove it. The error is deliberately swallowed per listener for that reason; the exception
    // is not rethrown here.
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Ignored on purpose: one faulty observer cannot break registry mutation or the other observers.
      }
    }
  }

  /**
   * Appends a write to `key`'s chain and makes it effective. Captures the key's base value when a chain starts.
   * Notifies only when the effective value actually changes.
   */
  addWrite(key: string, value: T): RegistryWrite<T> {
    let chain = this.writes.get(key);
    if (!chain || chain.length === 0) {
      if (!this.bases.has(key)) {
        const had = this.values.has(key);
        this.bases.set(key, had ? { has: true, value: this.values.get(key) } : { has: false });
      }
      chain = [];
      this.writes.set(key, chain);
    }

    const write: RegistryWrite<T> = { id: Symbol("registry-write"), value };
    chain.push(write);

    const had = this.values.has(key);
    const previous = this.values.get(key);
    this.values.set(key, value);
    if (!had || !Object.is(previous, value)) this.notify();
    return write;
  }

  /**
   * Removes the write with `id` from `key`'s chain and recomputes the effective value. Returns whether the write was
   * still present; a write already cleared by `remove` is a no-op.
   */
  removeWrite(key: string, id: symbol): boolean {
    const chain = this.writes.get(key);
    if (!chain) return false;
    const index = chain.findIndex(write => write.id === id);
    if (index < 0) return false;
    chain.splice(index, 1);
    this.recompute(key);
    return true;
  }

  /** Explicitly deletes a key: drops its whole write chain and base, then clears the effective value. */
  remove(key: string): boolean {
    const existed = this.values.has(key);
    this.writes.delete(key);
    this.bases.delete(key);
    if (existed) {
      this.values.delete(key);
      this.notify();
    }
    return existed;
  }

  /** Clears every entry, chain, base, and listener. Idempotent. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.values.clear();
    this.writes.clear();
    this.bases.clear();
    this.listeners.clear();
  }

  private recompute(key: string): void {
    const chain = this.writes.get(key);
    const had = this.values.has(key);
    const previous = this.values.get(key);

    if (chain && chain.length > 0) {
      this.values.set(key, chain[chain.length - 1].value);
    } else {
      this.writes.delete(key);
      const base = this.bases.get(key);
      if (base && base.has) this.values.set(key, base.value as T);
      else this.values.delete(key);
    }

    const nowHas = this.values.has(key);
    if (had !== nowHas || !Object.is(previous, this.values.get(key))) this.notify();
  }
}

/**
 * A handle bound to one context over a shared `RegistryCell`. Every `set` appends to the key's write chain and
 * registers a disposer (via the supplied `register` callback, normally the calling context's disposal stack) that
 * removes that exact write. Because the disposer lands on the caller's stack, a child plugin's disposal reverts only
 * the keys it registered, never its ancestors' or siblings' entries, and interleaved overwrites revert in any order.
 *
 * `onChange` observers live on the cell and are notified on `set`, `delete`, and on revert, so they fire across every
 * handle sharing the namespace. Every handle remembers the listeners it added, so disposing it (or calling the
 * disposer returned by `onChange`) detaches exactly those listeners; an owner handle still clears the whole cell.
 * `owner` controls whether disposing this handle clears the cell; the context creates all handles as non-owners
 * because the root context owns the cell's lifetime.
 */
export class ReversibleRegistry<T> {
  private disposed = false;
  /** Listeners registered through this handle, removed from the cell when it detaches. */
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly register: (disposer: Disposer) => void,
    private readonly cell: RegistryCell<T> = new RegistryCell<T>(),
    private readonly owner = true
  ) {}

  get size(): number {
    return this.cell.values.size;
  }

  set(key: string, value: T): void {
    this.assertActive();

    const write = this.cell.addWrite(key, value);
    this.register(() => {
      // Remove exactly this write and recompute; a later write may have superseded it, and an explicit delete may
      // have cleared the whole chain. Either way the key's effective value is derived from what remains.
      this.cell.removeWrite(key, write.id);
    });
  }

  get(key: string): T | undefined {
    return this.cell.values.get(key);
  }

  has(key: string): boolean {
    return this.cell.values.has(key);
  }

  delete(key: string): boolean {
    this.assertActive();
    return this.cell.remove(key);
  }

  keys(): string[] {
    return [...this.cell.values.keys()];
  }

  entries(): [string, T][] {
    return [...this.cell.values.entries()];
  }

  onChange(listener: () => void): Disposer {
    this.assertActive();
    this.cell.listeners.add(listener);
    this.listeners.add(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      this.cell.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.owner) {
      this.cell.dispose();
    } else {
      // A non-owning handle detaches only the listeners it added, leaving shared ones intact.
      for (const listener of this.listeners) this.cell.listeners.delete(listener);
    }
    this.listeners.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Cannot use a disposed registry");
  }
}
