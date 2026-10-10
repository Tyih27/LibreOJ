import { ApiProperty } from "@nestjs/swagger";

import { Type } from "class-transformer";
import { IsInt, ValidateNested } from "class-validator";

import { FileUploadInfoDto } from "../../file/dto";

export class ImportProblemTestDataArchiveRequestDto {
  @ApiProperty()
  @IsInt()
  readonly problemId: number;

  @ApiProperty()
  @ValidateNested()
  @Type(() => FileUploadInfoDto)
  readonly uploadInfo: FileUploadInfoDto;
}
