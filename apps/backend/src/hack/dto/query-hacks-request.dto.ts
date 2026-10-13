import { ApiProperty } from "@nestjs/swagger";

import { IsIn, IsInt, IsOptional } from "class-validator";

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
  readonly ownerId?: number;

  @ApiProperty()
  @IsOptional()
  @IsInt()
  readonly submissionId?: number;

  @ApiProperty()
  @IsOptional()
  @IsIn(["pending", "success", "fail"])
  readonly status?: "pending" | "success" | "fail";

  @ApiProperty()
  @IsOptional()
  @IsInt()
  readonly takeCount?: number;
}
