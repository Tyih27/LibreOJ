import { test } from "node:test";
import assert from "node:assert/strict";

import { SubmissionStatus } from "@libreoj/judge-protocol";

import {
  checkHackCreationPreconditions,
  hasHackPermission,
  isAcceptedFullScoreSubmission,
  makeHackTaskId,
  parseHackIdFromTaskId
} from "../src/hack/hack-policy";

test("hasHackPermission: administrators may always hack", () => {
  assert.equal(hasHackPermission(true, false), true);
  assert.equal(hasHackPermission(true, true), true);
});

test("hasHackPermission: a non-admin needs a full-score accepted submission", () => {
  assert.equal(hasHackPermission(false, true), true);
  assert.equal(hasHackPermission(false, false), false);
});

test("isAcceptedFullScoreSubmission: only Accepted with a full score passes", () => {
  assert.equal(isAcceptedFullScoreSubmission(SubmissionStatus.Accepted, 100), true);
  assert.equal(isAcceptedFullScoreSubmission(SubmissionStatus.Accepted, 0), false);
  assert.equal(isAcceptedFullScoreSubmission(SubmissionStatus.WrongAnswer, 100), false);
  assert.equal(isAcceptedFullScoreSubmission(null, null), false);
});

test("checkHackCreationPreconditions: rejects a missing problem", () => {
  assert.equal(
    checkHackCreationPreconditions({
      problemExists: false,
      hackable: true,
      submissionExists: true,
      submissionAccepted: true,
      hasPermission: true
    }),
    "NO_SUCH_PROBLEM"
  );
});

test("checkHackCreationPreconditions: rejects a non-hackable problem before the submission checks", () => {
  assert.equal(
    checkHackCreationPreconditions({
      problemExists: true,
      hackable: false,
      submissionExists: false,
      submissionAccepted: false,
      hasPermission: false
    }),
    "PROBLEM_NOT_HACKABLE"
  );
});

test("checkHackCreationPreconditions: rejects a missing submission", () => {
  assert.equal(
    checkHackCreationPreconditions({
      problemExists: true,
      hackable: true,
      submissionExists: false,
      submissionAccepted: false,
      hasPermission: true
    }),
    "NO_SUCH_SUBMISSION"
  );
});

test("checkHackCreationPreconditions: rejects a non-AC submission and an unauthorized hacker", () => {
  assert.equal(
    checkHackCreationPreconditions({
      problemExists: true,
      hackable: true,
      submissionExists: true,
      submissionAccepted: false,
      hasPermission: false
    }),
    "SUBMISSION_NOT_ACCEPTED"
  );

  assert.equal(
    checkHackCreationPreconditions({
      problemExists: true,
      hackable: true,
      submissionExists: true,
      submissionAccepted: true,
      hasPermission: false
    }),
    "PERMISSION_DENIED"
  );
});

test("checkHackCreationPreconditions: accepts a valid hack", () => {
  assert.equal(
    checkHackCreationPreconditions({
      problemExists: true,
      hackable: true,
      submissionExists: true,
      submissionAccepted: true,
      hasPermission: true
    }),
    null
  );
});

test("hack task IDs round-trip through parseHackIdFromTaskId", () => {
  assert.equal(makeHackTaskId(7), "hack-7");
  assert.equal(parseHackIdFromTaskId("hack-7"), 7);
  assert.equal(parseHackIdFromTaskId(makeHackTaskId(1234)), 1234);
});

test("parseHackIdFromTaskId rejects IDs that are not hack tasks", () => {
  assert.equal(parseHackIdFromTaskId("not-a-hack"), null);
  assert.equal(parseHackIdFromTaskId("hack-"), null);
  assert.equal(parseHackIdFromTaskId("hack-abc"), null);
  assert.equal(parseHackIdFromTaskId("hack-0"), null);
  assert.equal(parseHackIdFromTaskId("hack--3"), null);
  assert.equal(parseHackIdFromTaskId(null), null);
});
