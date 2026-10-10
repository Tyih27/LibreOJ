import { ApiProperty } from "@nestjs/swagger";

import { IsInt, IsBoolean } from "class-validator";

export class SetProblemHackableRequestDto {
  @ApiProperty()
  @IsInt()
  readonly problemId: number;

  @ApiProperty()
  @IsBoolean()
  readonly hackable: boolean;
}
