import { Inject, Injectable } from "@nestjs/common";

import type { ValidationError } from "class-validator";

import { CODE_LANGUAGE_REGISTRY, type CodeLanguageRegistry } from "@libreoj/plugin-api";

import { CodeLanguage } from "./code-language.type";

/**
 * Backend-facing adapter over the `codeLanguageRegistry` seam. The validation behaviour now lives in the
 * `@libreoj/plugin-code-language` plugin; this service only injects the kernel-provided registry and keeps the
 * existing public signature so every caller is unchanged.
 */
@Injectable()
export class CodeLanguageService {
  constructor(@Inject(CODE_LANGUAGE_REGISTRY) private readonly registry: CodeLanguageRegistry) {}

  validateCompileAndRunOptions(language: CodeLanguage, compileAndRunOptions: unknown): ValidationError[] {
    return this.registry.validateCompileAndRunOptions(language, compileAndRunOptions) as ValidationError[];
  }
}
