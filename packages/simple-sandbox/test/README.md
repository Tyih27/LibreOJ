# simple-sandbox tests

## Root-free tests

```bash
pnpm --filter simple-sandbox test
```

runs `test/*.test.js` with Node's built-in test runner. They only import the built module and inspect the host's
cgroup v2 hierarchy; no privileges are needed.

## Behavior tests (require root)

`test/sandbox.behavior.js` creates real cgroups and runs the sandbox end to end. It checks a normal exit, the memory
limit, the process limit, the time limit, and that the cgroup directory is removed after the run.

1. Build the fixtures and the minimal rootfs:

   ```bash
   sh test/fixtures/build.sh
   ```

   The script prefers `gcc -static`. If static libc is unavailable it downloads a static busybox and assembles
   shell-based fixtures instead; the memory and process assertions are then best effort.

2. Run the tests as root:

   ```bash
   sudo node test/sandbox.behavior.js
   ```

   Pass a rootfs directory as the first argument to use a different rootfs.
