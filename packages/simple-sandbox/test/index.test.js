'use strict';

// Root-free tests. They only exercise the JavaScript layer of the sandbox:
// importing the built module and inspecting the host's cgroup v2 hierarchy.
// Anything that actually creates a cgroup needs root and lives in
// test/sandbox.behavior.js instead.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'lib', 'index.js');

test('importing lib/index.js does not throw on a cgroup v2 host', () => {
    // Regression guard for the v1 -> v2 port. The old module-level check
    // required /sys/fs/cgroup/memory/memory.memsw.usage_in_bytes, which does
    // not exist on a unified (cgroup v2) host, so importing threw.
    assert.doesNotThrow(() => require(LIB));
});

test('exposes the startSandbox entry point', () => {
    const mod = require(LIB);
    assert.strictEqual(typeof mod.startSandbox, 'function');
    assert.strictEqual(typeof mod.getUidAndGidInSandbox, 'function');
});

test('the host provides a cgroup v2 unified hierarchy with the memory controller', () => {
    // The module-level capability check relies on this file and its contents.
    assert.ok(
        fs.existsSync('/sys/fs/cgroup/cgroup.controllers'),
        '/sys/fs/cgroup/cgroup.controllers must exist (cgroup v2)'
    );
    const controllers = fs.readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf8');
    assert.match(controllers, /(^|\s)memory(\s|$)/, 'memory controller must be available');
});
