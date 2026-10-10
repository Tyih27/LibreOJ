import { ApiProperty } from "@nestjs/swagger";

import { IsInt } from "class-validator";

export class GetHackRequestDto {
  @ApiProperty()
  @IsInt()
  readonly hackId: number;
}
