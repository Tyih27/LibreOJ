import { ApiProperty } from "@nestjs/swagger";

import { SignedFileUploadRequestDto } from "../../file/dto";

export enum ImportProblemTestDataArchiveResponseError {
  NO_SUCH_PROBLEM = "NO_SUCH_PROBLEM",
  PERMISSION_DENIED = "PERMISSION_DENIED",

  /** The client sent an upload UUID but the archive is not in object storage. */
  ARCHIVE_NOT_UPLOADED = "ARCHIVE_NOT_UPLOADED",
  /** The uploaded object is not a readable zip archive, or its entries cannot be mapped to valid filenames. */
  INVALID_ARCHIVE = "INVALID_ARCHIVE",
  /** The uploaded archive itself is larger than the testdata size limit. */
  ARCHIVE_TOO_LARGE = "ARCHIVE_TOO_LARGE",
  /** The archive contains more files than the testdata file limit. */
  TOO_MANY_FILES = "TOO_MANY_FILES",
  /** The archive's files exceed the testdata size limit once uncompressed. */
  TOTAL_SIZE_TOO_LARGE = "TOTAL_SIZE_TOO_LARGE"
}

export class ImportProblemTestDataArchiveResponseDto {
  @ApiProperty()
  error?: ImportProblemTestDataArchiveResponseError;

  @ApiProperty()
  signedUploadRequest?: SignedFileUploadRequestDto;
}
