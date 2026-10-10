import { Controller, Post, Body } from "@nestjs/common";
import { ApiOperation, ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { HackService } from "./hack.service";

import {
  CreateHackRequestDto,
  CreateHackResponseDto,
  QueryHacksRequestDto,
  QueryHacksResponseDto,
  GetHackRequestDto,
  GetHackResponseDto,
  GetHackResponseError
} from "./dto";

import { CurrentUser } from "../common/user.decorator";
import { UserEntity } from "../user/user.entity";
import { ProblemService, ProblemPermissionType } from "../problem/problem.service";
import { AuditLogObjectType, AuditService } from "../audit/audit.service";

@ApiTags("Hack")
@Controller("hack")
export class HackController {
  constructor(
    private readonly hackService: HackService,
    private readonly problemService: ProblemService,
    private readonly auditService: AuditService
  ) {}

  @Post("createHack")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Hack a submission by rejudging it against a hacker-provided input.",
    description:
      "Call with an empty uploadInfo.uuid to obtain a signed upload request, upload the input, then call again " +
      "with the returned UUID."
  })
  async createHack(
    @CurrentUser() currentUser: UserEntity,
    @Body() request: CreateHackRequestDto
  ): Promise<CreateHackResponseDto> {
    if (!currentUser)
      return {
        error: "PERMISSION_DENIED"
      };

    return await this.problemService.lockProblemById<CreateHackResponseDto>(
      request.problemId,
      "Read",
      async problem => {
        if (!problem)
          return {
            error: "NO_SUCH_PROBLEM"
          };

        const [error, signedUploadRequest, hack] = await this.hackService.createHack(
          currentUser,
          problem,
          request.submissionId,
          request.uploadInfo
        );

        if (error)
          return {
            error
          };
        if (signedUploadRequest)
          return {
            signedUploadRequest
          };

        await this.auditService.log("hack.create", AuditLogObjectType.Hack, hack.id, {
          problemId: problem.id,
          submissionId: request.submissionId,
          hackerId: currentUser.id,
          inputUuid: hack.inputUuid
        });

        return {
          hackId: hack.id
        };
      }
    );
  }

  @Post("queryHacks")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Query hacks."
  })
  async queryHacks(
    @CurrentUser() currentUser: UserEntity,
    @Body() request: QueryHacksRequestDto
  ): Promise<QueryHacksResponseDto> {
    if (!currentUser)
      return {
        error: "PERMISSION_DENIED"
      };

    // A problem-scoped query needs read access to that problem; otherwise only the current user's own hacks may be
    // listed (never a global dump).
    if (request.problemId) {
      const problem = await this.problemService.findProblemById(request.problemId);
      if (!problem || !(await this.problemService.userHasPermission(currentUser, problem, ProblemPermissionType.View)))
        return {
          error: "PERMISSION_DENIED"
        };
    } else if (request.hackerId !== currentUser.id) {
      return {
        error: "PERMISSION_DENIED"
      };
    }

    const hacks = await this.hackService.queryHacks(
      request.problemId,
      request.hackerId,
      request.submissionId,
      request.takeCount
    );
    return {
      hacks: hacks.map(hack => this.hackService.getHackMeta(hack))
    };
  }

  @Post("getHack")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get a hack's meta and the URL of its input."
  })
  async getHack(
    @CurrentUser() currentUser: UserEntity,
    @Body() request: GetHackRequestDto
  ): Promise<GetHackResponseDto> {
    const hack = await this.hackService.findHackById(request.hackId);
    if (!hack)
      return {
        error: GetHackResponseError.NO_SUCH_HACK
      };

    const problem = await this.problemService.findProblemById(hack.problemId);
    if (!problem || !(await this.problemService.userHasPermission(currentUser, problem, ProblemPermissionType.View)))
      return {
        error: GetHackResponseError.PERMISSION_DENIED
      };

    return {
      meta: this.hackService.getHackMeta(hack),
      inputUrl: await this.hackService.getHackInputUrl(hack)
    };
  }
}
