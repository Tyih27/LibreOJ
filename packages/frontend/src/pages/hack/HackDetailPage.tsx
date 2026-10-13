import React, { useEffect, useState } from "react";
import { Button, Header, Segment } from "semantic-ui-react";
import { observer } from "mobx-react";
import { v4 as uuid } from "uuid";

import { appState } from "@/appState";
import api from "@/api";
import { Link, useLocalizer } from "@/utils/hooks";
import UserLink from "@/components/UserLink";
import { OmittableAnsiCodeBox, OmittableString } from "@/components/CodeBox";
import { friendlyFormatDateTime } from "@/utils/formatDateTime";
import formatFileSize from "@/utils/formatFileSize";
import { getProblemUrl } from "@/pages/problem/utils";
import { defineRoute, RouteError } from "@/AppRouter";
import { makeToBeLocalizedText } from "@/locales";

// Mirrors the judge's HackDetails (see apps/judge/src/task/hack/index.ts).
interface ProgramDetails {
  status: string;
  time?: number;
  memory?: number;
  message?: OmittableString;
}

interface HackDetails {
  problemType?: string;
  validator?: { passed?: boolean; message?: OmittableString };
  standardProgram?: ProgramDetails;
  submission?: ProgramDetails;
  checker?: { score?: number; message?: OmittableString };
  reason?: string;
  message?: OmittableString;
}

async function fetchData(hackId: number) {
  const { requestError, response } = await api.hack.getHack({ hackId });

  if (requestError) throw new RouteError(requestError, { showRefresh: true, showBack: true });
  else if (response.error) throw new RouteError(makeToBeLocalizedText(`hack.error.${response.error}`));

  type RemoveOptional<T> = {
    [K in keyof T]-?: T[K];
  };
  return response as RemoveOptional<ApiTypes.GetHackResponseDto>;
}

interface HackDetailPageProps {
  meta: ApiTypes.HackMetaDto;
  inputUrl: string;
  details: unknown;
}

let HackDetailPage: React.FC<HackDetailPageProps> = props => {
  const _ = useLocalizer("hack");

  const [meta, setMeta] = useState(props.meta);
  const [details, setDetails] = useState<HackDetails | null>(props.details as HackDetails);

  useEffect(() => {
    appState.enterNewPage(`${_(".title")} #${props.meta.id}`, "submissions");
  }, [appState.locale, props.meta]);

  // Poll the hack while it is still judging
  useEffect(() => {
    if (meta.judgeTime != null) return;
    const timer = setInterval(async () => {
      const { requestError, response } = await api.hack.getHack({ hackId: props.meta.id });
      if (requestError || response.error || !response.meta) return;
      setMeta(response.meta);
      if (response.details) setDetails(response.details as unknown as HackDetails);
    }, 3000);
    return () => clearInterval(timer);
  }, [meta.judgeTime, props.meta.id]);

  function statusText(success?: number) {
    if (success == null) return _(".status.judging");
    if (success === 1) return _(".status.hacked");
    return _(".status.failed");
  }

  function renderProgram(title: string, program: ProgramDetails) {
    return (
      <>
        <p>
          <strong>{title}: </strong>
          {program.status}
          {program.time != null && <> · {Math.round(program.time)} ms</>}
          {program.memory != null && <> · {formatFileSize(program.memory * 1024, 1)}</>}
        </p>
        {program.message != null && (
          <OmittableAnsiCodeBox title={_(".details.message")} ansiMessage={program.message} />
        )}
      </>
    );
  }

  const problemUrl = meta.problem ? getProblemUrl(meta.problem) : getProblemUrl(meta.problemId);
  const submitTime = friendlyFormatDateTime(meta.submitTime);
  const judgeTime = meta.judgeTime != null ? friendlyFormatDateTime(meta.judgeTime) : null;

  const d = (details || {}) as HackDetails;
  const hasDetails = Object.keys(d).length > 0;

  return (
    <>
      <Header as="h1">
        {_(".title")} #{meta.id}
      </Header>
      <Segment>
        <p>
          <strong>{_(".problem")}: </strong>
          <Link href={problemUrl}>{meta.problemTitle || `P${meta.problemId}`}</Link>
        </p>
        <p>
          <strong>{_(".submission")}: </strong>
          <Link href={`/s/${meta.submissionId}`}>#{meta.submissionId}</Link>
        </p>
        <p>
          <strong>{_(".hacker")}: </strong>
          {meta.hacker ? <UserLink user={meta.hacker} /> : meta.hackerId}
        </p>
        <p>
          <strong>{_(".owner")}: </strong>
          {meta.owner ? <UserLink user={meta.owner} /> : meta.ownerId}
        </p>
        <p>
          <strong>{_(".submit_time")}: </strong>
          <span title={submitTime[1] as string}>{submitTime[0]}</span>
        </p>
        <p>
          <strong>{_(".judge_time")}: </strong>
          {judgeTime ? <span title={judgeTime[1] as string}>{judgeTime[0]}</span> : _(".status.judging")}
        </p>
        <p>
          <strong>{_(".status_label")}: </strong>
          {statusText(meta.success)}
        </p>
        {props.inputUrl && (
          <Button as="a" href={props.inputUrl} download icon="download" content={_(".download_input")} />
        )}
      </Segment>
      {hasDetails && (
        <Segment>
          <Header size="medium">{_(".details.title")}</Header>
          {d.problemType != null && (
            <p>
              <strong>{_(".details.problem_type")}: </strong>
              {d.problemType}
            </p>
          )}
          {d.validator && (
            <>
              <p>
                <strong>{_(".details.validator")}: </strong>
                {d.validator.passed ? _(".details.passed") : _(".details.failed")}
              </p>
              {d.validator.message != null && (
                <OmittableAnsiCodeBox title={_(".details.message")} ansiMessage={d.validator.message} />
              )}
            </>
          )}
          {d.standardProgram && renderProgram(_(".details.standard_program"), d.standardProgram)}
          {d.submission && renderProgram(_(".details.submission"), d.submission)}
          {d.checker && (
            <>
              <p>
                <strong>{_(".details.checker")}: </strong>
                {d.checker.score != null ? String(d.checker.score) : ""}
              </p>
              {d.checker.message != null && (
                <OmittableAnsiCodeBox title={_(".details.message")} ansiMessage={d.checker.message} />
              )}
            </>
          )}
          {d.reason != null && (
            <p>
              <strong>{_(".details.reason")}: </strong>
              {d.reason}
            </p>
          )}
          {d.message != null && <OmittableAnsiCodeBox title={_(".details.message")} ansiMessage={d.message} />}
        </Segment>
      )}
    </>
  );
};

HackDetailPage = observer(HackDetailPage);

export default defineRoute(async request => {
  const queryResult = await fetchData(parseInt(request.params.id) || 0);
  return <HackDetailPage key={uuid()} {...(queryResult as any)} />;
});
