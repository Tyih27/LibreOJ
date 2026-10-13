import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";

import { DataSource, Repository } from "typeorm";

import { HackTaskExtraInfo, JudgeTaskType, SubmissionStatus } from "@libreoj/judge-protocol";

import { HackEntity } from "./hack.entity";
import { HackProgress, HackProgressType } from "./hack-progress.interface";
import {
  checkHackCreationPreconditions,
  hasHackPermission,
  isAcceptedFullScoreSubmission,
  makeHackTaskId,
  parseHackIdFromTaskId
} from "./hack-policy";

import { CreateHackResponseError, HackMetaDto } from "./dto";

import { ProblemEntity } from "../problem/problem.entity";
import { ProblemService } from "../problem/problem.service";
import { ProblemFileType } from "../problem/problem-file.entity";
import { SubmissionEntity } from "../submission/submission.entity";
import { SubmissionDetailEntity } from "../submission/submission-detail.entity";
import { SubmissionService } from "../submission/submission.service";
import { JudgeQueueService, JudgeTaskPriorityType, JudgeTask } from "../judge/judge-queue.service";
import { JudgeTaskService } from "../judge/judge-task-service.interface";
import { MinioSignFor, FileService } from "../file/file.service";
import { FileEntity } from "../file/file.entity";
import { FileUploadInfoDto, SignedFileUploadRequestDto } from "../file/dto";
import { AuditLogObjectType, AuditService } from "../audit/audit.service";
import { UserEntity } from "../user/user.entity";
import { UserService } from "../user/user.service";
import { ConfigService } from "../config/config.service";
import { logger } from "../logger";

const MAX_QUERY_HACKS = 100;

@Injectable()
export class HackService implements JudgeTaskService<HackProgress, HackTaskExtraInfo> {
  constructor(
    @InjectDataSource()
    private readonly connection: DataSource,
    @InjectRepository(HackEntity)
    private readonly hackRepository: Repository<HackEntity>,
    @InjectRepository(SubmissionEntity)
    private readonly submissionRepository: Repository<SubmissionEntity>,
    @InjectRepository(SubmissionDetailEntity)
    private readonly submissionDetailRepository: Repository<SubmissionDetailEntity>,
    private readonly problemService: ProblemService,
    private readonly submissionService: SubmissionService,
    private readonly judgeQueueService: JudgeQueueService,
    private readonly fileService: FileService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly userService: UserService
  ) {
    this.judgeQueueService.registerTaskType(JudgeTaskType.Hack, this);

    this.auditService.registerObjectTypeQueryHandler(AuditLogObjectType.Hack, async hackId => {
      const hack = await this.findHackById(hackId);
      return !hack ? null : this.getHackMeta(hack);
    });
  }

  async findHackById(hackId: number): Promise<HackEntity> {
    return await this.hackRepository.findOneBy({ id: hackId });
  }

  async findHackByTaskId(taskId: string): Promise<HackEntity> {
    const hackId = parseHackIdFromTaskId(taskId);
    if (hackId == null) return null;
    return await this.findHackById(hackId);
  }

  getHackMeta(hack: HackEntity): HackMetaDto {
    return {
      id: hack.id,
      problemId: hack.problemId,
      submissionId: hack.submissionId,
      hackerId: hack.hackerId,
      ownerId: hack.ownerId,
      inputUuid: hack.inputUuid,
      submitTime: hack.submitTime,
      judgeTime: hack.judgeTime,
      success: hack.success
    };
  }

  async getHackMetaWithRelations(hack: HackEntity, currentUser: UserEntity): Promise<HackMetaDto> {
    const problem = await this.problemService.findProblemById(hack.problemId);
    const [hacker, owner] = await Promise.all([
      this.userService.findUserById(hack.hackerId),
      // `ownerId` is null only for rows created before the column existed.
      hack.ownerId != null ? this.userService.findUserById(hack.ownerId) : null
    ]);

    return {
      ...this.getHackMeta(hack),
      hacker: hacker ? await this.userService.getUserMeta(hacker, currentUser) : null,
      owner: owner ? await this.userService.getUserMeta(owner, currentUser) : null,
      problem: problem ? await this.problemService.getProblemMeta(problem) : null,
      problemTitle: problem
        ? await this.problemService.getProblemLocalizedTitle(problem, problem.locales[0])
        : `#${hack.problemId}`
    };
  }

  async getHackInputUrl(hack: HackEntity): Promise<string> {
    return await this.fileService.signDownloadLink({
      uuid: hack.inputUuid,
      downloadFilename: null,
      signFor: MinioSignFor.UserDownload
    });
  }

  async queryHacks(
    problemId: number,
    hackerId: number,
    submissionId: number,
    ownerId: number,
    status: "pending" | "success" | "fail",
    takeCount: number
  ): Promise<HackEntity[]> {
    const queryBuilder = this.hackRepository.createQueryBuilder();
    if (problemId) queryBuilder.andWhere("problemId = :problemId", { problemId });
    if (hackerId) queryBuilder.andWhere("hackerId = :hackerId", { hackerId });
    if (submissionId) queryBuilder.andWhere("submissionId = :submissionId", { submissionId });
    if (ownerId) queryBuilder.andWhere("ownerId = :ownerId", { ownerId });
    if (status === "pending") queryBuilder.andWhere("success IS NULL");
    else if (status === "success") queryBuilder.andWhere("success = 1");
    else if (status === "fail") queryBuilder.andWhere("success = 0");
    queryBuilder.orderBy("id", "DESC");
    queryBuilder.take(Math.min(takeCount || MAX_QUERY_HACKS, MAX_QUERY_HACKS));
    return await queryBuilder.getMany();
  }

  /**
   * @param problem Should be locked by `ProblemService.lockProblemById(id, "Read")`.
   */
  async createHack(
    hacker: UserEntity,
    problem: ProblemEntity,
    submissionId: number,
    uploadInfo: FileUploadInfoDto
  ): Promise<[error: CreateHackResponseError, signedUploadRequest: SignedFileUploadRequestDto, hack: HackEntity]> {
    const submission = await this.submissionRepository.findOneBy({ id: submissionId });
    // A submission can only be hacked on the problem it belongs to.
    const submissionMatchesProblem = !!submission && submission.problemId === problem.id;

    const hasAcceptedFullScoreSubmission =
      (await this.submissionRepository.countBy({
        submitterId: hacker.id,
        problemId: problem.id,
        status: SubmissionStatus.Accepted,
        score: 100
      })) > 0;

    const error = checkHackCreationPreconditions({
      problemExists: true,
      hackable: problem.hackable,
      submissionExists: submissionMatchesProblem,
      submissionAccepted:
        submissionMatchesProblem && isAcceptedFullScoreSubmission(submission.status, submission.score),
      hasPermission: hasHackPermission(hacker.isAdmin, hasAcceptedFullScoreSubmission)
    });
    if (error) return [error, null, null];

    const [fileErrorOrRequest, hack] = await this.connection.transaction<
      [fileErrorOrRequest: CreateHackResponseError | SignedFileUploadRequestDto, hack: HackEntity]
    >("READ COMMITTED", async transactionalEntityManager => {
      const result = await this.fileService.processUploadRequest(
        uploadInfo,
        size => (size <= this.configService.config.resourceLimit.submissionFileSize ? null : "FILE_TOO_LARGE"),
        transactionalEntityManager
      );

      if (!(result instanceof FileEntity)) return [result, null];

      // eslint-disable-next-line @typescript-eslint/no-shadow
      const hack = new HackEntity();
      hack.problemId = problem.id;
      hack.submissionId = submission.id;
      hack.hackerId = hacker.id;
      hack.ownerId = submission.submitterId;
      hack.inputUuid = result.uuid;
      hack.submitTime = new Date();
      hack.judgeTime = null;
      hack.success = null;
      hack.details = null;
      await transactionalEntityManager.save(hack);

      return [null, hack];
    });

    if (hack) {
      try {
        await this.judgeHack(hack);
      } catch (e) {
        logger.error(`Failed to start judge for hack ${hack.id}: ${e}`);
      }
      return [null, null, hack];
    }

    if (typeof fileErrorOrRequest === "string") return [fileErrorOrRequest, null, null];
    return [null, fileErrorOrRequest, null];
  }

  async judgeHack(hack: HackEntity): Promise<void> {
    await this.judgeQueueService.pushTask(makeHackTaskId(hack.id), JudgeTaskType.Hack, JudgeTaskPriorityType.Low);
  }

  /**
   * @return `false` means the task is canceled.
   */
  async onTaskProgress(taskId: string, progress: HackProgress): Promise<boolean> {
    const hack = await this.findHackByTaskId(taskId);
    if (!hack) {
      logger.warn(`Invalid task Id ${taskId} of hack task progress, maybe there's a too-early cancel?`);
      return false;
    }

    if (progress.progressType === HackProgressType.Finished) {
      hack.judgeTime = new Date();
      hack.success = progress.success ? 1 : 0;
      hack.details = progress.details ?? null;
      await this.hackRepository.save(hack);
      logger.log(`Hack ${hack.id} finished with success ${hack.success}`);

      // A successful hack appends its input and the standard program's output as a new extra test, then rejudges every
      // score-100 submission. This is best-effort: a failure here must not fail the hack progress itself.
      if (hack.success === 1 && typeof progress.stdOutputUuid === "string") {
        try {
          const outputFile = await this.fileService.processJudgeUploadedFile(progress.stdOutputUuid);
          if (!outputFile) {
            logger.warn(`Hack ${hack.id} reported a standard output ${progress.stdOutputUuid} that is not uploaded`);
          } else {
            const filenames = await this.problemService.appendHackExtraTest(
              hack.problemId,
              hack.inputUuid,
              outputFile.uuid
            );
            if (!filenames) {
              logger.warn(`Failed to append the extra test of hack ${hack.id} to problem ${hack.problemId}`);
            } else {
              const rejudged = await this.submissionService.rejudgeProblemAcceptedSubmissions(hack.problemId);
              await this.auditService.log("hack.apply_extra_test", AuditLogObjectType.Hack, hack.id, {
                inputFile: filenames.inputFile,
                outputFile: filenames.outputFile,
                rejudgedSubmissions: rejudged
              });
            }
          }
        } catch (e) {
          logger.error(`Failed to apply the extra test of hack ${hack.id}: ${e}`);
        }
      }
    }

    return true;
  }

  async getTaskToBeSentToJudgeByTaskId(taskId: string, priority: number): Promise<JudgeTask<HackTaskExtraInfo>> {
    try {
      const hack = await this.findHackByTaskId(taskId);
      if (!hack) return null;

      const submission = await this.submissionRepository.findOneBy({ id: hack.submissionId });
      if (!submission) return null;
      const submissionDetail = await this.submissionDetailRepository.findOneBy({ submissionId: submission.id });
      if (!submissionDetail) return null;

      const problem = await this.problemService.findProblemById(hack.problemId);
      if (!problem) return null;
      const [preprocessedJudgeInfo] = await this.problemService.getProblemPreprocessedJudgeInfo(problem);
      const testData = await this.problemService.getProblemFiles(problem, ProblemFileType.TestData);

      return new JudgeTask<HackTaskExtraInfo>(taskId, JudgeTaskType.Hack, JudgeTaskPriorityType.Low, priority, {
        problemType: problem.type,
        judgeInfo: preprocessedJudgeInfo,
        testData: Object.fromEntries(testData.map(problemFile => [problemFile.filename, problemFile.uuid])),
        submissionContent: submissionDetail.content,
        submissionFile: submissionDetail.fileUuid
          ? {
              uuid: submissionDetail.fileUuid,
              url: await this.fileService.signDownloadLink({
                uuid: submissionDetail.fileUuid,
                downloadFilename: null,
                noExpire: true,
                signFor: MinioSignFor.Judge
              })
            }
          : undefined,
        hackInput: {
          uuid: hack.inputUuid,
          url: await this.fileService.signDownloadLink({
            uuid: hack.inputUuid,
            downloadFilename: null,
            noExpire: true,
            signFor: MinioSignFor.Judge
          })
        }
      });
    } catch (e) {
      logger.error(`Error in getTaskToBeSentToJudgeByTaskId("${taskId}"): ${e}`);
      return null;
    }
  }
}
