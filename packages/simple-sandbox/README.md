# simple-sandbox

`simple-sandbox` is LibreOJ's Linux process sandbox. It creates PID, mount, network, and UTS namespaces; configures
cgroup v2 (unified) resource controllers; mounts a rootfs; drops privileges; and executes the requested program
through a Node.js native addon.

## Requirements

- Linux with the cgroup v2 (unified) hierarchy and the `memory`, `pids`, and `cpu` controllers enabled
- Linux kernel 5.19 or newer, because memory accounting reads `memory.peak`
- CMake and a C++17 compiler
- Node.js headers
- `libfmt`
- a rootfs containing `/etc/passwd` and the configured sandbox user

cgroup v1 is no longer supported.

## Build

```bash
pnpm --filter simple-sandbox build
pnpm --filter simple-sandbox build:native
```

The TypeScript build writes `lib`. The native build writes `build/Release/sandbox.node`.

## Runtime

Judge working directories should be separate tmpfs mounts. Output-size accounting includes the resulting filesystem
tree. The runtime supports cgroup v2 (unified) and Linux namespaces; it does not support cgroup v1 or mount byte
limits.

Legacy cgroup v1 limits are mapped onto cgroup v2 as follows:

- `memory.limit_in_bytes` becomes `memory.max`.
- `memory.memsw.limit_in_bytes` (memory plus swap) cannot be expressed directly, so the sandbox sets `memory.max`
  and disables swap with `memory.swap.max = 0`. A configured memory limit therefore also forbids swapping.
- The reported memory peak is `memory.peak` minus the `file` field of `memory.stat`, i.e. the peak minus page cache.
- The reported CPU time is `cpu.stat`'s `usage_usec`, converted to nanoseconds.

Because cgroup v2 cannot reset `cpu.stat` or `memory.peak` in place, a group with an existing name is killed and
recreated so its counters always start at zero.

## Tests

```bash
pnpm --filter simple-sandbox test
```

runs the root-free tests with Node's built-in test runner. The behavior tests create real cgroups and must run as
root:

```bash
sudo node test/sandbox.behavior.js
```

See [test/README.md](test/README.md) for how the static test rootfs is prepared.

The package is licensed under the [MIT License](LICENSE).
