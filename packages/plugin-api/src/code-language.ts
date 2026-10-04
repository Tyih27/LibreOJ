/**
 * Service Definition for the `codeLanguageRegistry` seam.
 *
 * Mirrors the backend's code-language module without importing it, so a Service Provider (today: the backend's
 * `CodeLanguageService`, later: a plugin) and its Consumers share one contract while remaining in separate
 * workspaces. The seam is deliberately re-declared here rather than imported from `apps/*`.
 */

/**
 * The code languages the platform can compile and run. This is the single source of truth: the backend re-exports it
 * from `apps/backend/src/code-language/code-language.type.ts`, and the registry seam below is keyed by it.
 *
 * It is a string enum, matching the backend's original `CodeLanguage` declaration member-for-member so every existing
 * use (member access, `Object.values(CodeLanguage)`, class-validator's `@IsEnum`) behaves unchanged.
 */
export enum CodeLanguage {
  Cpp = "cpp",
  C = "c",
  Java = "java",
  Kotlin = "kotlin",
  Pascal = "pascal",
  Python = "python",
  Swift = "swift",
  Rust = "rust",
  Go = "go",
  Haskell = "haskell",
  CSharp = "csharp",
  FSharp = "fsharp"
}

/**
 * A single validation failure produced while checking compile-and-run options. Structurally compatible with the
 * `ValidationError` returned by the backend's `class-validator`-based implementation, without depending on
 * `class-validator` from this leaf package.
 */
export interface CodeLanguageValidationError {
  property: string;
  constraints?: Record<string, string>;
  children?: CodeLanguageValidationError[];
}

/**
 * The `codeLanguageRegistry` service. Method name and shape mirror the public surface of `CodeLanguageService` in
 * `apps/backend/src/code-language/code-language.service.ts`.
 *
 * `compileAndRunOptions` is intentionally `unknown`: the backend validates the raw request payload before it is
 * narrowed, so the per-language option shapes are not part of the seam yet.
 */
export interface CodeLanguageRegistry {
  validateCompileAndRunOptions(language: CodeLanguage, compileAndRunOptions: unknown): CodeLanguageValidationError[];
}

/** Service name a `CodeLanguageRegistry` provider registers under. */
export const CODE_LANGUAGE_REGISTRY = "codeLanguageRegistry";
