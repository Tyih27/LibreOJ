import { ApiProperty } from "@nestjs/swagger";

import { UserMetaDto } from "../../user/dto";
import { ProblemMetaDto } from "../../problem/dto";

export class HackMetaDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  problemId: number;

  @ApiProperty()
  submissionId: number;

  @ApiProperty()
  hackerId: number;

  @ApiProperty()
  ownerId: number;

  @ApiProperty()
  inputUuid: string;

  @ApiProperty()
  submitTime: Date;

  // null means the hack is still pending
  @ApiProperty()
  judgeTime: Date;

  // null: pending; 1: the hack succeeded (the hacked submission is wrong on the hack input); 0: it is still accepted
  @ApiProperty()
  success?: number;

  @ApiProperty()
  hacker?: UserMetaDto;

  @ApiProperty()
  owner?: UserMetaDto;

  @ApiProperty()
  problem?: ProblemMetaDto;

  @ApiProperty()
  problemTitle?: string;
}
