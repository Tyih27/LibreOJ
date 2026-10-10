import { Entity, PrimaryGeneratedColumn, Index, ManyToOne, Column, JoinColumn } from "typeorm";

import { ProblemEntity } from "../problem/problem.entity";
import { SubmissionEntity } from "../submission/submission.entity";
import { UserEntity } from "../user/user.entity";

@Entity("hack")
export class HackEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProblemEntity, { onDelete: "CASCADE" })
  @JoinColumn()
  problem: Promise<ProblemEntity>;

  @Column()
  @Index()
  problemId: number;

  @ManyToOne(() => SubmissionEntity, { onDelete: "CASCADE" })
  @JoinColumn()
  submission: Promise<SubmissionEntity>;

  @Column()
  @Index()
  submissionId: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn()
  hacker: Promise<UserEntity>;

  @Column()
  @Index()
  hackerId: number;

  // The uuid of the FileEntity holding the hacker-provided input
  @Column({ type: "char", length: 36 })
  inputUuid: string;

  @Column({ type: "datetime" })
  submitTime: Date;

  // null means the hack is still pending
  @Column({ type: "datetime", nullable: true })
  judgeTime: Date;

  // null: pending; 1: the hack succeeded (the hacked submission is wrong on the hack input); 0: it is still accepted
  @Column({ type: "tinyint", nullable: true })
  success: number;

  @Column({ type: "json", nullable: true })
  details: unknown;
}
