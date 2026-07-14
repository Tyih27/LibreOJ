# LibreOJ Judge

The Judge consumes tasks from the Backend, downloads submission and problem files, compiles programs, executes them
inside `simple-sandbox`, runs checkers, and streams progress to the Backend over Socket.IO.

## Requirements

- Linux with cgroup v1 `memory`, `cpuacct`, and `pids` controllers
- root privileges
- CMake, a C++17 compiler, and `libfmt`
- the `vendor/testlib` submodule
- a compiler rootfs compatible with `infra/sandbox-rootfs`

## Build

From the repository root:

```bash
git submodule update --init --recursive
pnpm --filter '@libreoj/judge...' --sort run build
pnpm build:native
```

## Configuration

Create a Judge client in the Backend, copy `config-example.yaml`, and set its key. Configure persistent data and
binary-cache directories, download limits, concurrency, task working directories, and the sandbox rootfs.

Each task working directory should be a separate tmpfs mount. One Judge key identifies one active machine; use
different keys for different machines.

## Run

```bash
sudo env LIBREOJ_JUDGE_CONFIG_FILE=./config.yaml pnpm --filter @libreoj/judge start
```

`LIBREOJ_JUDGE_LOG_LEVEL` overrides the configured log level. `taskConsumingThreads` controls concurrent Judge tasks,
while `maxConcurrentTasks` limits compile and run operations.

The supervisor restarts the worker after a Backend disconnection. Unacknowledged tasks return to the Redis queue and
are loaded from current database state before another Judge receives them.
