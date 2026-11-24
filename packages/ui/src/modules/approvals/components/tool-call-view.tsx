import type { ApprovalStatus, McpToolCallPayload } from "api-server-api";
import { match } from "ts-pattern";

import { toolCallArgumentsOf } from "../lib/tool-call-arguments.js";
import { templateToolCallOf } from "../lib/tool-call-renderers.js";
import { SlackMessagePreview } from "./slack-message-preview.js";

function ArgumentsBlock({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-60 overflow-auto rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap break-all text-foreground/90">
      {text}
    </pre>
  );
}

function Note({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the call a tool-call approval holds, as the person who answers it sees it: what a Template renders for its own tool, such as the Slack message a post sends, else the arguments as JSON. It says when the arguments were cut, when the call sent none, and why they are gone once the approval settled.
 */
export function ToolCallView({
  payload,
  status,
}: {
  payload: McpToolCallPayload;
  status: ApprovalStatus;
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
        .with({ kind: "whole" }, ({ json }) => {
          const message = templateToolCallOf(payload)?.message;
          return message ? (
            <SlackMessagePreview call={message} />
          ) : (
            <ArgumentsBlock text={json} />
          );
        })
        .exhaustive()}
    </div>
  );
}
