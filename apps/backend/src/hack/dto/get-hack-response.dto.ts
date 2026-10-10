import { ApiProperty } from "@nestjs/swagger";

import { HackMetaDto } from "./hack-meta.dto";

export enum GetHackResponseError {
  NO_SUCH_HACK = "NO_SUCH_HACK",
  PERMISSION_DENIED = "PERMISSION_DENIED"
}

export class GetHackResponseDto {
  @ApiProperty({ enum: GetHackResponseError })
  error?: GetHackResponseError;

  @ApiProperty()
  meta?: HackMetaDto;

  @ApiProperty()
  inputUrl?: string;
}
