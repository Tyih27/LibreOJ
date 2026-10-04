import type { Disposer } from "./disposable";

export type Listener = (...args: unknown[]) => void;

/**
 * A single-level (non-bubbling) event bus. `emit` only invokes the listeners registered on this bus; layered bubbling
 * is the responsibility of `Context`, which walks its parent chain and calls `emit` on each bus.
 */
export class EventBus {
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): Disposer {
    const existing = this.listeners.get(event);
    if (existing) existing.push(listener);
    else this.listeners.set(event, [listener]);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.listeners.get(event);
      if (!current) return;
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.listeners.delete(event);
    };
  }

  emit(event: string, ...args: unknown[]): void {
    const current = this.listeners.get(event);
    if (!current || current.length === 0) return;
    // Snapshot so listeners may safely register or remove listeners while emitting.
    for (const listener of [...current]) listener(...args);
  }

  clear(): void {
    this.listeners.clear();
  }
}
