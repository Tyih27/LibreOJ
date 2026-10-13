import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { HackEntity } from "./hack.entity";

import { HackService } from "./hack.service";

import { HackController } from "./hack.controller";

import { SubmissionEntity } from "../submission/submission.entity";
import { SubmissionDetailEntity } from "../submission/submission-detail.entity";
import { SubmissionModule } from "../submission/submission.module";
import { ProblemModule } from "../problem/problem.module";
import { JudgeModule } from "../judge/judge.module";
import { FileModule } from "../file/file.module";
import { AuditModule } from "../audit/audit.module";
import { UserModule } from "../user/user.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([HackEntity]),
    TypeOrmModule.forFeature([SubmissionEntity]),
    TypeOrmModule.forFeature([SubmissionDetailEntity]),
    forwardRef(() => ProblemModule),
    forwardRef(() => SubmissionModule),
    forwardRef(() => JudgeModule),
    forwardRef(() => FileModule),
    forwardRef(() => AuditModule),
    forwardRef(() => UserModule)
  ],
  providers: [HackService],
  controllers: [HackController],
  exports: [HackService]
})
export class HackModule {}
