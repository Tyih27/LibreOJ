'use strict';

// Root-only behavior tests for simple-sandbox on cgroup v2.
//
//   sh test/fixtures/build.sh
//   sudo node test/sandbox.behavior.js [rootfs-dir]
//
// These tests create real cgroups under /sys/fs/cgroup and therefore require
// root. They are NOT run by `pnpm test` (which is root-free).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { startSandbox, getUidAndGidInSandbox, SandboxStatus } = require('../lib/index.js');

const rootfs = path.resolve(process.argv[2] || path.join(__dirname, 'fixtures', 'rootfs'));

if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    console.error('These tests create cgroups and must run as root:');
    console.error('  sudo node test/sandbox.behavior.js');
    process.exit(1);
}

if (!fs.existsSync(path.join(rootfs, 'etc', 'passwd'))) {
    console.error(`No rootfs at ${rootfs}. Build it first: sh test/fixtures/build.sh`);
    process.exit(1);
}

const user = getUidAndGidInSandbox(rootfs, 'sandbox');

async function run(executable, overrides) {
    const parameter = Object.assign({
        hostname: 'sandbox',
        chroot: rootfs,
        mounts: [],
        executable,
        parameters: [executable],
        environments: ['PATH=/bin'],
        time: 10 * 1000,
        // Note: the native addon computes memory.max as memory / 4 * 5, so a
        // negative value would be clamped to 0. Use a concrete generous limit.
        memory: 512 * 1024 * 1024,
        process: -1,
        mountProc: false,
        redirectBeforeChroot: true,
        user,
        cgroup: '',
        workingDirectory: '/',
    }, overrides);

    const sandboxed = startSandbox(parameter);
    const group = sandboxed.parameter.cgroup;
    const result = await sandboxed.waitForStop();
    return { result, group };
}

function assertCleaned(group) {
    const dir = path.join('/sys/fs/cgroup', group);
    assert.ok(!fs.existsSync(dir), `cgroup ${dir} should have been removed after the run`);
}

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test('normal exit', async () => {
    const { result, group } = await run('/bin/exit_ok');
    assert.strictEqual(result.status, SandboxStatus.OK, JSON.stringify(result));
    assert.strictEqual(result.code, 0);
    assertCleaned(group);
});

test('memory limit exceeded', async () => {
    // The addon reserves 25% headroom, so a 16 MiB limit caps memory near
    // 20 MiB while the fixture tries to touch 2 GiB.
    const { result, group } = await run('/bin/mem_hog', { memory: 16 * 1024 * 1024 });
    assert.strictEqual(result.status, SandboxStatus.MemoryLimitExceeded, JSON.stringify(result));
    assertCleaned(group);
});

test('process limit enforced', async () => {
    const { result, group } = await run('/bin/fork_many', { process: 5 });
    // fork_many exits with code 7 when it could not spawn all 64 children.
    assert.strictEqual(result.status, SandboxStatus.OK, JSON.stringify(result));
    assert.strictEqual(result.code, 7, JSON.stringify(result));
    assertCleaned(group);
});

test('time limit exceeded', async () => {
    const { result, group } = await run('/bin/busy_loop', { time: 200 });
    assert.strictEqual(result.status, SandboxStatus.TimeLimitExceeded, JSON.stringify(result));
    assertCleaned(group);
});

(async () => {
    let failed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`PASS ${name}`);
        } catch (e) {
            failed++;
            console.error(`FAIL ${name}: ${e && e.message}`);
        }
    }
    if (failed > 0) {
        console.error(`${failed} of ${tests.length} behavior tests failed`);
        process.exit(1);
    }
    console.log(`all ${tests.length} behavior tests passed`);
})();
