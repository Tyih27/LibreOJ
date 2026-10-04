import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { load } from "js-yaml";
import { main } from "./dump-config";

interface Dump {
  plugins: { name: string; source: string; disabled: boolean; state: string; config: Record<string, unknown> }[];
  warnings: string[];
}

async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await main(argv);
    return { code, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

test("dumps the demo profile end to end, resolving local plugins and gating activation", async () => {
  const { code, stdout, stderr } = await run(["fixtures/demo/profile.yaml"]);

  assert.equal(stderr, "");
  assert.equal(code, 0);

  const dump = load(stdout) as Dump;
  // A local plugin is identified by the entry string the profile used (its path), per ResolvedPlugin.name.
  const byName = new Map(dump.plugins.map(plugin => [plugin.name, plugin]));

  assert.ok(byName.has("./provides"));
  assert.ok(byName.has("./consumes"));

  // `provides` supplies `greeting`, which activates `consumes`.
  assert.equal(byName.get("./provides")?.state, "active");
  assert.equal(byName.get("./consumes")?.state, "active");
  assert.equal(byName.get("./consumes")?.source, "plugins");

  // The disabled bundle is reported, not loaded.
  const disabled = byName.get("@fixture/disabled-plugin");
  assert.equal(disabled?.state, "disabled");
  assert.equal(disabled?.disabled, true);
});

test("applies a --patch overlay on top of the profile", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-dump-"));
  const patchFile = path.join(dir, "patch.yaml");
  writeFileSync(patchFile, "config:\n  './consumes':\n    flag: true\n");

  const { code, stdout } = await run(["fixtures/demo/profile.yaml", "--patch", patchFile]);
  assert.equal(code, 0);

  const dump = load(stdout) as Dump;
  const consumes = dump.plugins.find(plugin => plugin.name === "./consumes");
  assert.equal(consumes?.config.flag, true);
});

test("applies LIBREOJ_PATCH_FILE as a home patch between the profile and --patch", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-dump-home-"));
  const home = path.join(dir, "home.yaml");
  const cli = path.join(dir, "cli.yaml");
  writeFileSync(home, "config:\n  './consumes':\n    home: true\n    shared: home\n");
  writeFileSync(cli, "config:\n  './consumes':\n    cli: true\n    shared: cli\n");

  const previous = process.env.LIBREOJ_PATCH_FILE;
  process.env.LIBREOJ_PATCH_FILE = home;
  try {
    const { code, stdout } = await run(["fixtures/demo/profile.yaml", "--patch", cli]);
    assert.equal(code, 0);

    const dump = load(stdout) as Dump;
    const consumes = dump.plugins.find(plugin => plugin.name === "./consumes");
    assert.equal(consumes?.config.home, true);
    assert.equal(consumes?.config.cli, true);
    // The CLI patch is applied after the home patch, so it wins the shared key.
    assert.equal(consumes?.config.shared, "cli");
  } finally {
    if (previous === undefined) delete process.env.LIBREOJ_PATCH_FILE;
    else process.env.LIBREOJ_PATCH_FILE = previous;
  }
});

test("prints usage and returns non-zero when the profile is missing", async () => {
  const { code, stdout, stderr } = await run([]);

  assert.notEqual(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /Usage:/);
});

test("prints usage and returns non-zero on an unknown flag", async () => {
  const { code, stdout, stderr } = await run(["--bogus", "fixtures/demo/profile.yaml"]);

  assert.notEqual(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown option "--bogus"/);
  assert.match(stderr, /Usage:/);
});

test("stacks multiple --patch overlays in order, with later patches winning", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-dump-stack-"));
  const first = path.join(dir, "first.yaml");
  const second = path.join(dir, "second.yaml");
  writeFileSync(first, "config:\n  './consumes':\n    a: 1\n    shared: first\n");
  writeFileSync(second, "config:\n  './consumes':\n    b: 2\n    shared: second\n");

  const { code, stdout } = await run(["fixtures/demo/profile.yaml", "--patch", first, "--patch", second]);
  assert.equal(code, 0);

  const dump = load(stdout) as Dump;
  const consumes = dump.plugins.find(plugin => plugin.name === "./consumes");
  assert.equal(consumes?.config.a, 1);
  assert.equal(consumes?.config.b, 2);
  assert.equal(consumes?.config.shared, "second");
});
