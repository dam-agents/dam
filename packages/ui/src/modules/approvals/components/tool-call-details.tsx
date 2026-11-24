import type { ApprovalView, McpToolCallPayload } from "api-server-api";

import {
  approvalToolCallSource,
  MCP_TOOL_CALL_ONCE_NOTE,
} from "../../home/lib/approval-copy.js";
import { toolCallArgumentsOf } from "../lib/tool-call-arguments.js";
import { ArgumentsBlock } from "./arguments-block.js";

export function ToolCallDetails({
  approval,
  payload,
}: {
  approval: ApprovalView;
  payload: McpToolCallPayload;
}) {
  const args = toolCallArgumentsOf(payload, approval.status);
  return (
    <div
      data-testid="tool-call-details"
      className="flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-2.5"
    >
      <p
        data-testid="tool-call-source"
        className="font-mono text-xs break-all text-muted-foreground"
      >
        {approvalToolCallSource(approval)}
      </p>
      {args.kind === "whole" && <ArgumentsBlock text={args.json} />}
      <p className="text-xs text-muted-foreground">{MCP_TOOL_CALL_ONCE_NOTE}</p>
    </div>
  );
}
