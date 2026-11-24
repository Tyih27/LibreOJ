/**
 * Every TypeORM entity registered with the backend's `DataSource`.
 *
 * The current `databaseProviders` factory hands TypeORM a filesystem glob
 * (`${__dirname}/../**\/*.entity{.ts,.js}`). That glob is depth-dependent and, under `synchronize: true`, can pick up
 * stale compiled entities from `dist`. This explicit list replaces it at the M7.5 cutover, when the `DataSource`
 * construction moves into the composition root and `__dirname` no longer points at the source tree.
 *
 * Keep it in sync with the `*.entity.ts` files under `src`; `test/entities.test.ts` fails when the two drift apart.
 */

import { AuditLogEntity } from "../audit/audit-log.entity";
import { UserAuthEntity } from "../auth/user-auth.entity";
import { DiscussionContentEntity } from "../discussion/discussion-content.entity";
import { DiscussionReplyReactionEntity } from "../discussion/discussion-reply-reaction.entity";
import { DiscussionReplyEntity } from "../discussion/discussion-reply.entity";
import { DiscussionReactionEntity } from "../discussion/discussion-reaction.entity";
import { DiscussionEntity } from "../discussion/discussion.entity";
import { FileEntity } from "../file/file.entity";
import { GroupMembershipEntity } from "../group/group-membership.entity";
import { GroupEntity } from "../group/group.entity";
import { HackEntity } from "../hack/hack.entity";
import { JudgeClientEntity } from "../judge/judge-client.entity";
import { LocalizedContentEntity } from "../localized-content/localized-content.entity";
import { UserMigrationInfoEntity } from "../migration/user-migration-info.entity";
import { PermissionForGroupEntity } from "../permission/permission-for-group.entity";
import { PermissionForUserEntity } from "../permission/permission-for-user.entity";
import { ProblemFileEntity } from "../problem/problem-file.entity";
import { ProblemJudgeInfoEntity } from "../problem/problem-judge-info.entity";
import { ProblemSampleEntity } from "../problem/problem-sample.entity";
import { ProblemTagMapEntity } from "../problem/problem-tag-map.entity";
import { ProblemTagEntity } from "../problem/problem-tag.entity";
import { ProblemEntity } from "../problem/problem.entity";
import { SettingsEntity } from "../settings/settings.entity";
import { SubmissionDetailEntity } from "../submission/submission-detail.entity";
import { SubmissionEntity } from "../submission/submission.entity";
import { UserInformationEntity } from "../user/user-information.entity";
import { UserPreferenceEntity } from "../user/user-preference.entity";
import { UserPrivilegeEntity } from "../user/user-privilege.entity";
import { UserEntity } from "../user/user.entity";

/** All 29 entity classes, in a stable order. */
export const ALL_ENTITIES = [
  AuditLogEntity,
  UserAuthEntity,
  DiscussionContentEntity,
  DiscussionEntity,
  DiscussionReactionEntity,
  DiscussionReplyEntity,
  DiscussionReplyReactionEntity,
  FileEntity,
  GroupEntity,
  GroupMembershipEntity,
  HackEntity,
  JudgeClientEntity,
  LocalizedContentEntity,
  UserMigrationInfoEntity,
  PermissionForGroupEntity,
  PermissionForUserEntity,
  ProblemEntity,
  ProblemFileEntity,
  ProblemJudgeInfoEntity,
  ProblemSampleEntity,
  ProblemTagEntity,
  ProblemTagMapEntity,
  SettingsEntity,
  SubmissionDetailEntity,
  SubmissionEntity,
  UserEntity,
  UserInformationEntity,
  UserPreferenceEntity,
  UserPrivilegeEntity
];
