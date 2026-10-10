import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { HackEntity } from "./hack.entity";

import { HackService } from "./hack.service";

import { HackController } from "./hack.controller";

import { SubmissionEntity } from "../submission/submission.entity";
import { SubmissionDetailEntity } from "../submission/submission-detail.entity";
import { ProblemModule } from "../problem/problem.module";
import { JudgeModule } from "../judge/judge.module";
import { FileModule } from "../file/file.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([HackEntity]),
    TypeOrmModule.forFeature([SubmissionEntity]),
    TypeOrmModule.forFeature([SubmissionDetailEntity]),
    forwardRef(() => ProblemModule),
    forwardRef(() => JudgeModule),
    forwardRef(() => FileModule),
    forwardRef(() => AuditModule)
  ],
  providers: [HackService],
  controllers: [HackController],
  exports: [HackService]
})
export class HackModule {}
