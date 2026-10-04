#!/usr/bin/env node
import * as path from "node:path";
import { PluginHost } from "../host";
import { NodeResolver } from "../node-resolver";
import { loadPatchFile, loadProfileFile } from "../profile";

const USAGE = "Usage: libreoj-dump-config <profile.yaml> [--patch <patch.yaml>]...";

interface Arguments {
  profile: string;
  patches: string[];
}

/** Parses CLI arguments. All failures (including a missing profile) are thrown with the usage text. */
export function parseArguments(argv: string[]): Arguments {
  let profile: string | undefined;
  const patches: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--patch") {
      const value = argv[++index];
      if (value === undefined) throw new Error(`--patch requires a file path\n${USAGE}`);
      patches.push(value);
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option "${argument}"\n${USAGE}`);
    } else if (profile === undefined) {
      profile = argument;
    } else {
      throw new Error(`Unexpected argument "${argument}"\n${USAGE}`);
    }
  }

  if (profile === undefined) throw new Error(USAGE);
  return { profile, patches };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves a profile (plus any `--patch` overlays), loads its plugin tree, and writes the dump to stdout. Returns the
 * process exit code: 0 on success, 1 when arguments, a file, or plugin resolution fails.
 *
 * Relative plugin paths in the profile are resolved from the profile file's directory, so a profile and its local
 * plugins travel together.
 */
export async function main(argv: string[]): Promise<number> {
  let parsed: Arguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 1;
  }

  const profilePath = path.resolve(parsed.profile);
  const host = new PluginHost({
    resolver: new NodeResolver({ baseDir: path.dirname(profilePath) }),
    failureMode: "skip"
  });

  try {
    const layers = [
      ...loadProfileFile(profilePath),
      ...parsed.patches.map(patch => loadPatchFile(path.resolve(patch)))
    ];
    await host.load(layers);
    const output = host.dumpConfig();
    await host.dispose();
    process.stdout.write(output);
    return 0;
  } catch (error) {
    await host.dispose().catch(() => {});
    process.stderr.write(`${describeError(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
