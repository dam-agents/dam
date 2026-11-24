import type { ApprovalStatus, McpToolCallPayload } from "api-server-api";
import { match } from "ts-pattern";

import { toolCallArgumentRows } from "../lib/tool-call-argument-rows.js";
import { toolCallArgumentsOf } from "../lib/tool-call-arguments.js";
import { templateToolCallOf } from "../lib/tool-call-renderers.js";
import { ArgumentsBlock } from "./arguments-block.js";
import { SlackMessagePreview } from "./slack-message-preview.js";
import { ToolCallArgumentList } from "./tool-call-argument-list.js";

function Note({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function WholeArguments({
  payload,
  value,
  json,
  sender,
}: {
  payload: McpToolCallPayload;
  value: unknown;
  json: string;
  sender: string;
}) {
  const message = templateToolCallOf(payload)?.message;
  if (message) return <SlackMessagePreview message={message} sender={sender} />;
  const rows = toolCallArgumentRows(value);
  if (!rows) return <ArgumentsBlock text={json} />;
  if (rows.length === 0) return <Note>The call sends no arguments.</Note>;
  return <ToolCallArgumentList rows={rows} />;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the call a tool-call approval holds, as the person who answers it sees it: what a Template renders for its own tool, such as the Slack message a post sends under the name of the account that sends it, else the arguments as names and values. It says when the arguments were cut, when the call sent none, and why they are gone once the approval settled.
 */
export function ToolCallView({
  payload,
  status,
  sender,
}: {
  payload: McpToolCallPayload;
  status: ApprovalStatus;
  sender: string;
}) {
  const args = toolCallArgumentsOf(payload, status);
  return (
    <div data-testid="tool-call-view" className="flex min-w-0 flex-col gap-1">
      {match(args)
        .with({ kind: "none" }, () => <Note>The call sends no arguments.</Note>)
        .with({ kind: "gone" }, ({ why }) => <Note>{why}</Note>)
        .with({ kind: "cut" }, ({ text, note }) => (
          <>
            <ArgumentsBlock text={text} />
            <Note>{note}</Note>
          </>
        ))
        .with({ kind: "whole" }, ({ value, json }) => (
          <WholeArguments
            payload={payload}
            value={value}
            json={json}
            sender={sender}
          />
        ))
        .exhaustive()}
    </div>
  );
}
