#!/usr/bin/env node
import { validatePlugin, type PluginValidationResult } from "../validate";

const USAGE = "Usage: libreoj-plugin-validate <name-or-path> [--base-dir <dir>] [--json]";

interface Arguments {
  target: string;
  baseDir?: string;
  json: boolean;
}

/** Parses CLI arguments. All failures (including a missing target) are thrown with the usage text. */
export function parseArguments(argv: string[]): Arguments {
  let target: string | undefined;
  let baseDir: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--base-dir") {
      const value = argv[++index];
      if (value === undefined) throw new Error(`--base-dir requires a directory\n${USAGE}`);
      baseDir = value;
    } else if (argument === "--json") {
      json = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option "${argument}"\n${USAGE}`);
    } else if (target === undefined) {
      target = argument;
    } else {
      throw new Error(`Unexpected argument "${argument}"\n${USAGE}`);
    }
  }

  if (target === undefined) throw new Error(USAGE);
  return { target, baseDir, json };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Renders the human-readable report: a header, then `error:` / `warning:` lines, then `ok` or `failed`. */
function format(result: PluginValidationResult): string {
  const lines: string[] = [`plugin: ${result.requested}`];
  if (result.definitionName !== undefined) lines.push(`definition: ${result.definitionName}`);
  if (result.entry !== undefined) lines.push(`entry: ${result.entry}`);
  if (result.moduleKind !== undefined) lines.push(`module: ${result.moduleKind}`);
  for (const error of result.errors) lines.push(`error: ${error}`);
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  lines.push(result.ok ? "ok" : "failed");
  return `${lines.join("\n")}\n`;
}

/**
 * Validates a plugin package and reports the result. Returns the process exit code: 0 when the package conforms,
 * 1 when arguments are invalid or validation fails. `--json` writes the full {@link PluginValidationResult} to
 * stdout instead of the human report; the exit code follows `ok` either way.
 */
export async function main(argv: string[]): Promise<number> {
  let parsed: Arguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 1;
  }

  let result: PluginValidationResult;
  try {
    result = await validatePlugin(parsed.target, parsed.baseDir === undefined ? {} : { baseDir: parsed.baseDir });
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 1;
  }

  if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(format(result));

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
