import { ApiProperty } from "@nestjs/swagger";

import { IsInt, IsOptional } from "class-validator";

export class QueryHacksRequestDto {
  @ApiProperty()
  @IsOptional()
  @IsInt()
  readonly problemId?: number;

  @ApiProperty()
  @IsOptional()
  @IsInt()
  readonly hackerId?: number;

  @ApiProperty()
  @IsOptional()
  @IsInt()
  readonly submissionId?: number;

  @ApiProperty()
  @IsOptional()
  @IsInt()
  readonly takeCount?: number;
}
