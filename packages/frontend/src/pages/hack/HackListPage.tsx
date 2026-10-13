import React, { useEffect, useState } from "react";
import { Button, Form, Header, Icon, Message, Segment, Table } from "semantic-ui-react";
import { observer } from "mobx-react";
import { v4 as uuid } from "uuid";

import style from "./HackListPage.module.less";

import api from "@/api";
import { appState } from "@/appState";
import { useLocalizer, useNavigationChecked, Link } from "@/utils/hooks";
import UserLink from "@/components/UserLink";
import { friendlyFormatDateTime } from "@/utils/formatDateTime";
import { getProblemUrl } from "@/pages/problem/utils";
import { defineRoute, RouteError } from "@/AppRouter";

type HackStatus = "pending" | "success" | "fail";

interface HacksQuery {
  problemId?: number;
  submissionId?: number;
  hackerId?: number;
  ownerId?: number;
  status?: HackStatus;
}

const HACK_STATUSES: HackStatus[] = ["pending", "success", "fail"];

const HACK_STATUS_TEXT_KEYS: Record<HackStatus, string> = {
  pending: ".status.judging",
  success: ".status.hacked",
  fail: ".status.failed"
};

function normalizePositiveInt(value: string): number {
  if (!value) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function normalizeQuery(query: Record<string, string>): HacksQuery {
  const result: HacksQuery = {
    problemId: normalizePositiveInt(query.problemId),
    submissionId: normalizePositiveInt(query.submissionId),
    hackerId: normalizePositiveInt(query.hackerId),
    ownerId: normalizePositiveInt(query.ownerId),
    status: HACK_STATUSES.includes(query.status as HackStatus) ? (query.status as HackStatus) : null
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value != null)) as HacksQuery;
}

interface HacksData {
  hacks: ApiTypes.HackMetaDto[];
  onlyMine: boolean;
}

async function fetchData(query: HacksQuery): Promise<HacksData> {
  // An unfiltered query is denied for normal users, so fall back to the current user's own hacks.
  const hasScope = !!(query.problemId || query.hackerId || query.ownerId);
  const { requestError, response } = await api.hack.queryHacks({ ...query });

  if (requestError) throw new RouteError(requestError, { showRefresh: true, showBack: true });

  if (response.error === "PERMISSION_DENIED" && !hasScope && appState.currentUser) {
    const { requestError: retryRequestError, response: retryResponse } = await api.hack.queryHacks({
      ...query,
      hackerId: appState.currentUser.id
    });
    if (retryRequestError) throw new RouteError(retryRequestError, { showRefresh: true, showBack: true });
    return { hacks: retryResponse.hacks || [], onlyMine: true };
  }

  return { hacks: response.hacks || [], onlyMine: false };
}

interface HackListPageProps {
  query: HacksQuery;
  data: HacksData;
}

let HackListPage: React.FC<HackListPageProps> = props => {
  const _ = useLocalizer("hack");
  const navigation = useNavigationChecked();

  useEffect(() => {
    appState.enterNewPage(_(".list_title"), "submissions");
  }, [appState.locale]);

  const [queryProblemId, setQueryProblemId] = useState(props.query.problemId ? String(props.query.problemId) : "");
  const [querySubmissionId, setQuerySubmissionId] = useState(
    props.query.submissionId ? String(props.query.submissionId) : ""
  );
  const [queryStatus, setQueryStatus] = useState<HackStatus>(props.query.status || null);

  function onFilter() {
    const query: Partial<HacksQuery> = {};
    const problemId = normalizePositiveInt(queryProblemId);
    const submissionId = normalizePositiveInt(querySubmissionId);
    if (problemId) query.problemId = problemId;
    if (submissionId) query.submissionId = submissionId;
    if (queryStatus) query.status = queryStatus;

    navigation.navigate({
      query: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, value.toString()]))
    });
  }

  function statusText(success?: number) {
    if (success == null) return _(".status.judging");
    if (success === 1) return _(".status.hacked");
    return _(".status.failed");
  }

  const hacks = props.data.hacks;

  return (
    <>
      <Form className={style.queryForm}>
        <Form.Group inline unstackable>
          <Form.Input
            className={style.queryInputProblemId}
            icon="hashtag"
            iconPosition="left"
            placeholder={_(".query.problem_id")}
            value={queryProblemId}
            onChange={(e, { value }) => setQueryProblemId(value)}
          />
          <Form.Input
            className={style.queryInputSubmissionId}
            icon="file outline"
            iconPosition="left"
            placeholder={_(".query.submission_id")}
            value={querySubmissionId}
            onChange={(e, { value }) => setQuerySubmissionId(value)}
          />
          <Form.Select
            className={style.queryInputStatus + (!queryStatus ? " " + style.selectedAll : "")}
            value={queryStatus || "ALL"}
            onChange={(e, { value }) => setQueryStatus(value === "ALL" ? null : (value as HackStatus))}
            options={[
              { key: "", value: "ALL", text: _(".status.all") },
              ...HACK_STATUSES.map(status => ({
                key: status,
                value: status,
                text: _(HACK_STATUS_TEXT_KEYS[status])
              }))
            ]}
          />
          <Button className={style.queryButton} icon="search" content={_(".query.search")} onClick={() => onFilter()} />
          {appState.currentUser && (
            <Button
              className={style.quickLinkFirst}
              primary
              as={Link}
              icon="user"
              content={_(".my_hacks")}
              href={{ pathname: "/hacks", query: { hackerId: appState.currentUser.id.toString() } }}
            />
          )}
          {appState.currentUser && (
            <Button
              as={Link}
              icon="inbox"
              content={_(".hacks_to_me")}
              href={{ pathname: "/hacks", query: { ownerId: appState.currentUser.id.toString() } }}
            />
          )}
        </Form.Group>
      </Form>
      {props.data.onlyMine && <Message content={_(".only_mine_notice")} />}
      {hacks.length === 0 ? (
        <Segment placeholder>
          <Header icon>
            <Icon name="search" />
            {_(".list_title")}
          </Header>
        </Segment>
      ) : (
        <>
          <Table textAlign="center" basic="very" className={style.table} unstackable>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell textAlign="left">{_(".columns.id")}</Table.HeaderCell>
                <Table.HeaderCell textAlign="left">{_(".columns.problem")}</Table.HeaderCell>
                <Table.HeaderCell textAlign="left">{_(".columns.submission")}</Table.HeaderCell>
                <Table.HeaderCell textAlign="left">{_(".columns.hacker")}</Table.HeaderCell>
                <Table.HeaderCell textAlign="left">{_(".columns.owner")}</Table.HeaderCell>
                <Table.HeaderCell textAlign="left">{_(".columns.submit_time")}</Table.HeaderCell>
                <Table.HeaderCell textAlign="left">{_(".columns.status")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {hacks.map(hack => {
                const timeString = friendlyFormatDateTime(hack.submitTime);
                return (
                  <Table.Row key={hack.id}>
                    <Table.Cell textAlign="left">
                      <Link href={`/h/${hack.id}`}>#{hack.id}</Link>
                    </Table.Cell>
                    <Table.Cell textAlign="left">
                      <Link href={hack.problem ? getProblemUrl(hack.problem) : getProblemUrl(hack.problemId)}>
                        {hack.problemTitle || `#${hack.problemId}`}
                      </Link>
                    </Table.Cell>
                    <Table.Cell textAlign="left">
                      <Link href={`/s/${hack.submissionId}`}>#{hack.submissionId}</Link>
                    </Table.Cell>
                    <Table.Cell textAlign="left">{hack.hacker && <UserLink user={hack.hacker} />}</Table.Cell>
                    <Table.Cell textAlign="left">{hack.owner && <UserLink user={hack.owner} />}</Table.Cell>
                    <Table.Cell textAlign="left" title={timeString[1] as string}>
                      {timeString[0]}
                    </Table.Cell>
                    <Table.Cell textAlign="left">{statusText(hack.success)}</Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </>
      )}
    </>
  );
};

HackListPage = observer(HackListPage);

export default defineRoute(async request => {
  const query = normalizeQuery(request.query);
  const data = await fetchData(query);

  return <HackListPage key={uuid()} query={query} data={data} />;
});
