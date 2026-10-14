import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import { main, parseArguments } from "./validate-plugin";

const packageDir = path.join(__dirname, "..", "..");

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

test("validates a good package with a human report and exits 0", async () => {
  const { code, stdout, stderr } = await run(["./fixtures/demo/provides", "--base-dir", packageDir]);

  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /plugin: \.\/fixtures\/demo\/provides/);
  assert.match(stdout, /definition: @fixture\/provides/);
  assert.match(stdout, /module: cjs/);
  assert.match(stdout, /^ok$/m);
});

test("reports a bad package and exits 1", async () => {
  const { code, stdout, stderr } = await run(["./fixtures/does-not-exist", "--base-dir", packageDir]);

  assert.equal(stderr, "");
  assert.equal(code, 1);
  assert.match(stdout, /^error: Cannot resolve plugin/m);
  assert.match(stdout, /^failed$/m);
});

test("--json prints the full result to stdout and still follows the exit code", async () => {
  const { code, stdout } = await run(["./fixtures/bad-inject", "--base-dir", packageDir, "--json"]);

  assert.equal(code, 1);
  const result = JSON.parse(stdout) as { ok: boolean; errors: string[] };
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("prints usage and returns non-zero when the target is missing", async () => {
  const { code, stdout, stderr } = await run([]);

  assert.notEqual(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /Usage:/);
});

test("prints usage and returns non-zero on an unknown flag", async () => {
  const { code, stdout, stderr } = await run(["--bogus", "./fixtures/demo/provides"]);

  assert.notEqual(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown option "--bogus"/);
  assert.match(stderr, /Usage:/);
});

test("prints usage and returns non-zero when --base-dir has no value", async () => {
  const { code, stdout, stderr } = await run(["./fixtures/demo/provides", "--base-dir"]);

  assert.notEqual(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /--base-dir requires a directory/);
  assert.match(stderr, /Usage:/);
});

test("parses --base-dir and --json together", () => {
  const parsed = parseArguments(["plugin", "--base-dir", "/tmp/base", "--json"]);
  assert.deepEqual(parsed, { target: "plugin", baseDir: "/tmp/base", json: true });
});
