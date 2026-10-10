import { ApiProperty } from "@nestjs/swagger";

import { HackMetaDto } from "./hack-meta.dto";

export class QueryHacksResponseDto {
  @ApiProperty({ type: [HackMetaDto] })
  hacks?: HackMetaDto[];

  @ApiProperty()
  error?: "PERMISSION_DENIED";
}
