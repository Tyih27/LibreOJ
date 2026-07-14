# simple-sandbox

`simple-sandbox` is LibreOJ's Linux process sandbox. It creates PID, mount, network, and UTS namespaces; configures
cgroup v1 resource controllers; mounts a rootfs; drops privileges; and executes the requested program through a
Node.js native addon.

## Requirements

- Linux with cgroup v1 memory and swap accounting
- CMake and a C++17 compiler
- Node.js headers
- `libfmt`
- a rootfs containing `/etc/passwd` and the configured sandbox user

## Build

```bash
pnpm --filter simple-sandbox build
pnpm --filter simple-sandbox build:native
```

The TypeScript build writes `lib`. The native build writes `build/Release/sandbox.node`.

## Runtime

Judge working directories should be separate tmpfs mounts. Output-size accounting includes the resulting filesystem
tree. The runtime supports cgroup v1 and Linux namespaces; it does not support cgroup v2 or mount byte limits.

The package is licensed under the [MIT License](LICENSE).
