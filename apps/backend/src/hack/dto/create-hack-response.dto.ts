import { ApiProperty } from "@nestjs/swagger";

import { SignedFileUploadRequestDto } from "../../file/dto";
import { HackCreationError } from "../hack-policy";

export type CreateHackResponseError = HackCreationError | "FILE_TOO_LARGE" | "FILE_UUID_EXISTS" | "FILE_NOT_UPLOADED";

export class CreateHackResponseDto {
  @ApiProperty()
  error?: CreateHackResponseError;

  @ApiProperty()
  hackId?: number;

  @ApiProperty()
  signedUploadRequest?: SignedFileUploadRequestDto;
}
