# LibreOJ Judge

The judge is a privileged Linux service that consumes tasks from the LibreOJ Backend, downloads immutable files,
compiles submissions, runs them in `simple-sandbox`, and streams progress back over Socket.IO.

## Requirements

- Linux with cgroup v1 `memory`, `cpuacct`, and `pids` controllers
- root privileges
- a C++17 compiler, CMake, and `libfmt`
- the testlib submodule
- a compiler rootfs compatible with `infra/sandbox-rootfs`

Build the TypeScript packages and native addons from the repository root:

```bash
git submodule update --init --recursive
pnpm --filter '@libreoj/judge...' --sort run build
pnpm build:native
```

The filter suffix includes the Judge's workspace dependencies, so pnpm builds `simple-sandbox` and the shared Judge
protocol before the Judge itself.

## Configuration and startup

Register one judge client in the Backend, copy `config-example.yaml`, and replace its example key. Data storage is
persistent; binary cache and task working directories are cleared on process startup. Each working directory should
be a separate tmpfs mount.

```bash
sudo env LIBREOJ_JUDGE_CONFIG_FILE=./config.yaml pnpm --filter @libreoj/judge start
```

Use `LIBREOJ_JUDGE_LOG_LEVEL` to override the configured Winston level.

One judge key identifies one active machine. Never run concurrent clients with the same key: Backend session
ownership and disconnect recovery assume a single connection. Increase `taskConsumingThreads` and
`maxConcurrentTasks` for parallelism on one host.

The supervisor restarts the TypeScript worker when the Backend connection is lost. Unacknowledged tasks are returned
to the Redis queue and rehydrated from current database state before another Judge receives them.
