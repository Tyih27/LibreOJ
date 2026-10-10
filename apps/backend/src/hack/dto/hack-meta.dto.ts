import { ApiProperty } from "@nestjs/swagger";

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
  inputUuid: string;

  @ApiProperty()
  submitTime: Date;

  // null means the hack is still pending
  @ApiProperty()
  judgeTime: Date;

  // null: pending, 0: the hacked submission is wrong on the hack input, 1: it is still accepted
  @ApiProperty()
  success?: number;
}
