import { Module } from "@nestjs/common";

import { CodeLanguageService } from "./code-language.service";

import { PluginModule } from "../plugin/plugin.module";

@Module({
  imports: [PluginModule],
  providers: [CodeLanguageService],
  exports: [CodeLanguageService]
})
export class CodeLanguageModule {}
