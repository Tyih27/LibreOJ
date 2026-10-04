/** A callback that undoes one unit of work. Calling it more than once must be safe. */
export type Disposer = () => void;

interface DisposableEntry {
  disposer: Disposer;
  active: boolean;
}

/**
 * Collects disposers and runs them in reverse registration order (LIFO) when `run` is called. `run` is idempotent,
 * each disposer runs at most once, and `add` returns a disposer that unregisters its entry and runs it eagerly.
 */
export class DisposableStack {
  private readonly entries: DisposableEntry[] = [];
  private isDisposed = false;

  get disposed(): boolean {
    return this.isDisposed;
  }

  add(disposer: Disposer): Disposer {
    if (this.isDisposed) throw new Error("Cannot add a disposer to a disposed DisposableStack");

    const entry: DisposableEntry = { disposer, active: true };
    this.entries.push(entry);

    return () => {
      if (!entry.active) return;
      entry.active = false;
      const index = this.entries.indexOf(entry);
      if (index >= 0) this.entries.splice(index, 1);
      entry.disposer();
    };
  }

  run(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    const pending = this.entries.splice(0).reverse();
    const failures: unknown[] = [];
    for (const entry of pending) {
      if (!entry.active) continue;
      entry.active = false;
      try {
        entry.disposer();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) throw failures[0];
  }
}
