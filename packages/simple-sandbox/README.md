# simple-sandbox

`simple-sandbox` is LibreOJ's internal native process sandbox. It creates Linux PID, mount, network, and UTS
namespaces; configures cgroup v1 resource controllers; mounts the configured rootfs; drops privileges; and executes
the requested program.

The package is private; native builds run as explicit workspace tasks instead of npm install hooks. Its original MIT
attribution remains in `LICENSE`.

## Build

Requirements are Linux, CMake, a C++17 compiler, Node.js headers, and `libfmt`.

```bash
pnpm --filter simple-sandbox build
pnpm --filter simple-sandbox build:native
```

The TypeScript build writes `lib`; the native build writes `build/Release/sandbox.node`.

## Runtime contract

The host kernel must expose cgroup v1 memory+swap accounting. The supplied rootfs must contain `/etc/passwd` and the
configured sandbox user. Judge working directories should be isolated tmpfs mounts because output-size enforcement
also measures the resulting filesystem tree.

The current implementation is Linux-only and does not implement cgroup v2 or mount byte limits.
