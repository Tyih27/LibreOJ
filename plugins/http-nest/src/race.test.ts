import assert from "node:assert/strict";
import { test } from "node:test";

import { HttpNestServer, type HttpNestOptions, type NestApplicationLike, type NestFactoryLike } from "./server";

/** A fake Nest application whose lifecycle can be observed without a real Nest instance. */
class FakeApp implements NestApplicationLike {
  closed = false;
  used = false;
  listenCalls = 0;
  port: number | null = null;

  use(): unknown {
    this.used = true;
    return this;
  }

  async listen(port?: number): Promise<unknown> {
    this.listenCalls += 1;
    this.port = port ?? 0;
    return undefined;
  }

  getHttpServer(): { address(): unknown } {
    return { address: () => ({ port: this.port ?? 0 }) };
  }

  get<T = unknown>(): T {
    return undefined as unknown as T;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  nest: NestFactoryLike;
  created: FakeApp[];
  /** Resolves the first held create() call, if the harness was built with a gate. */
  release(): void;
}

/**
 * Builds a Nest runtime whose first create() can be held open, so a test can schedule close() while a creation is
 * still in flight. Without a gate, create() resolves with an already-constructed app.
 */
function harness(options: { gate?: boolean } = {}): Harness {
  const created: FakeApp[] = [];
  const gate = options.gate ? deferred() : null;
  let consumed = false;

  const nest: NestFactoryLike = {
    async create() {
      const app = new FakeApp();
      created.push(app);
      if (gate && !consumed) {
        consumed = true;
        await gate.promise;
      }
      return app;
    }
  };

  return {
    nest,
    created,
    release: () => gate?.resolve()
  };
}

function makeServer(
  nest: NestFactoryLike,
  extra: Omit<Partial<HttpNestOptions>, "rootModule" | "nest"> = {}
): HttpNestServer {
  return new HttpNestServer({ rootModule: {}, nest, port: 0, ...extra });
}

/** Yields to the event loop so a scheduled prepare/bind can reach its awaited step. */
function tick(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

test("concurrent prepare() creates the application exactly once", async () => {
  const h = harness({ gate: true });
  const server = makeServer(h.nest);

  const first = server.prepare();
  const second = server.prepare();
  await tick();
  assert.equal(h.created.length, 1, "create should be called once while the first prepare is in flight");

  h.release();
  await Promise.all([first, second]);
  assert.equal(h.created.length, 1);
  assert.ok(server.application);
});

test("concurrent listen() binds exactly once", async () => {
  const h = harness();
  const server = makeServer(h.nest);

  await Promise.all([server.listen(), server.listen()]);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].listenCalls, 1, "the port must be bound once");
  assert.equal(server.listening, true);
  assert.ok(server.address);
});

test("a failed prepare() can be retried", async () => {
  let calls = 0;
  const nest: NestFactoryLike = {
    async create() {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return new FakeApp();
    }
  };
  const server = makeServer(nest);

  await assert.rejects(server.prepare(), /boom/);
  await server.prepare();
  assert.equal(calls, 2);
  assert.ok(server.application);
});

test("close() during an in-flight prepare() closes the produced application (no leak)", async () => {
  const h = harness({ gate: true });
  const server = makeServer(h.nest);

  const preparing = server.prepare();
  await tick();

  const closing = server.close();
  h.release(); // the creation completes after close began, and must be discarded

  await assert.rejects(preparing, /closed while preparing/);
  await closing;

  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].closed, true, "the application created after close must be closed");
  assert.equal(server.application, null);
  assert.equal(server.listening, false);
});

test("close() during an in-flight listen() releases the application", async () => {
  const listenGate = deferred();
  const created: FakeApp[] = [];

  class SlowApp extends FakeApp {
    async listen(port?: number): Promise<unknown> {
      await listenGate.promise;
      return super.listen(port);
    }
  }

  const nest: NestFactoryLike = {
    async create() {
      const app = new SlowApp();
      created.push(app);
      return app;
    }
  };
  const server = makeServer(nest);

  const listening = server.listen();
  await tick();

  const closing = server.close();
  listenGate.resolve();

  await assert.rejects(listening, /closed while listening/);
  await closing;

  assert.equal(created.length, 1);
  assert.equal(created[0].closed, true, "the application bound after close must be closed");
  assert.equal(server.listening, false);
});

test("listen() after close() composes and binds a fresh application", async () => {
  const h = harness();
  const server = makeServer(h.nest);

  await server.listen();
  assert.equal(h.created.length, 1);
  await server.close();
  assert.equal(server.listening, false);

  await server.listen();
  assert.equal(h.created.length, 2, "a new application is created after close");
  assert.equal(server.listening, true);
});

test("a throwing configureApp closes the application and rejects prepare()", async () => {
  const h = harness();
  const server = makeServer(h.nest, {
    configureApp: () => {
      throw new Error("configure failed");
    }
  });

  await assert.rejects(server.prepare(), /configure failed/);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].closed, true);
  assert.equal(server.application, null);
});
