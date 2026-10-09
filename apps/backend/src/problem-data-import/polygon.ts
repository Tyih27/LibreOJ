import type { ProblemDataImportResult, ProblemDataImporter } from "./importer";

import type { ProblemFileEntity } from "../problem/problem-file.entity";

/**
 * The Codeforces Polygon / Codeforces testdata importer.
 *
 * Polygon archives name their tests by sequence number with no extension -- `1`, `2`, `10` -- and pair each input
 * with a same-named answer carrying the `.a` suffix (`1.a`, `2.a`, `10.a`). This differs from the built-in native
 * convention, which pairs `X.in` with `X.out` / `X.ans`. Recognizing the extension-less inputs keeps the two layouts
 * disjoint, so the registry never confuses one for the other.
 *
 * Only traditional problems carry an input plus an answer per test: interaction problems have no answer file and
 * submit-answer problems have no input file, so this importer deliberately matches nothing for those types.
 *
 * No configuration file is involved -- the layout is inferred purely from the filenames -- hence the result is not
 * authoritative and only contributes the subtasks it derives.
 */

/** A filename is an input when it carries no extension, i.e. no dot at all. */
function isInputFilename(filename: string): boolean {
  return !filename.includes(".");
}

/** Orders pure-integer names numerically, and everything else lexicographically. */
function compareFilenames(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pairs every extension-less input with its existing `N.a` answer, sorted by name.
 *
 * A file is only paired when both the input and its `.a` answer are present; a lone `3.a` whose input `3` is missing
 * is ignored.
 */
function findPairs(testData: ProblemFileEntity[]): { inputFile: string; outputFile: string }[] {
  const filenames = new Set(testData.map(file => file.filename));
  return testData
    .map(file => file.filename)
    .filter(isInputFilename)
    .filter(filename => filenames.has(`${filename}.a`))
    .sort(compareFilenames)
    .map(inputFile => ({ inputFile, outputFile: `${inputFile}.a` }));
}

export const polygonImporter: ProblemDataImporter = {
  name: "codeforces-polygon",
  priority: 50,
  authoritative: false,
  detect(testData: ProblemFileEntity[], context): boolean {
    return context.problemType === "traditional" && findPairs(testData).length > 0;
  },
  import(testData: ProblemFileEntity[]): ProblemDataImportResult {
    return { subtasks: [{ scoringType: "Sum", testcases: findPairs(testData) }] };
  }
};
