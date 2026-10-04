import type { Disposer } from "./disposable";

/** An event listener; returning a value other than `undefined` bails out the emit. */
export type Listener = (...args: unknown[]) => unknown;

/** The three priority tiers an event's listeners are split into, invoked in this order. */
type Tier = "before" | "on" | "after";

interface EventListeners {
  before: Listener[];
  on: Listener[];
  after: Listener[];
}

/**
 * A single-level (non-bubbling) event bus. `emit` only invokes the listeners registered on this bus; layered bubbling
 * is the responsibility of `Context`, which walks its parent chain and calls `emit` on each bus.
 *
 * Listeners are split into three tiers: `before` runs first, then normal `on` listeners, then `after`; within a tier
 * they run in registration order. A listener that returns a value other than `undefined` bails out: no later listener
 * (in this tier, a later tier, or — once `Context` sees the return value — an ancestor's bus) runs, and `emit` returns
 * that value. `once` registers a normal-tier listener that removes itself before it first fires.
 */
export class EventBus {
  private readonly listeners = new Map<string, EventListeners>();

  /** Registers a normal-tier listener. */
  on(event: string, listener: Listener): Disposer {
    return this.add(event, "on", listener);
  }

  /** Registers a `before`-tier listener, which runs before the event's normal listeners. */
  before(event: string, listener: Listener): Disposer {
    return this.add(event, "before", listener);
  }

  /** Registers an `after`-tier listener, which runs after the event's normal listeners. */
  after(event: string, listener: Listener): Disposer {
    return this.add(event, "after", listener);
  }

  /** Registers a normal-tier listener that removes itself as soon as it first fires. */
  once(event: string, listener: Listener): Disposer {
    let off: Disposer = () => {};
    const wrapped: Listener = (...args) => {
      off();
      return listener(...args);
    };
    off = this.add(event, "on", wrapped);
    return off;
  }

  /** Invokes the event's listeners in tier then registration order, returning the first non-`undefined` result. */
  emit(event: string, ...args: unknown[]): unknown {
    const current = this.listeners.get(event);
    if (!current) return undefined;

    for (const tier of [current.before, current.on, current.after]) {
      // Snapshot so listeners may safely register or remove listeners while emitting.
      for (const listener of [...tier]) {
        const result = listener(...args);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  }

  clear(): void {
    this.listeners.clear();
  }

  private add(event: string, tier: Tier, listener: Listener): Disposer {
    let record = this.listeners.get(event);
    if (!record) {
      record = { before: [], on: [], after: [] };
      this.listeners.set(event, record);
    }
    const bus = record;
    const list = bus[tier];
    list.push(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
      if (bus.before.length === 0 && bus.on.length === 0 && bus.after.length === 0) {
        this.listeners.delete(event);
      }
    };
  }
}
