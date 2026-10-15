import { Warning } from "@carbon/icons-react";

import type { AgentView } from "../../../types.js";
import { splitConsole, terminationNotice } from "../lib/crash-notices.js";

export function TerminationReason({
  agent,
  size,
}: {
  agent: Pick<AgentView, "podTerminationReason" | "podTerminationCode" | "vm">;
  size: "sm" | "xs";
}) {
  const reason = agent.podTerminationReason;
  if (!reason) return null;
  const { consoleTail } = splitConsole(reason);
  return (
    <div
      className={`flex flex-col gap-2 ${size === "sm" ? "max-w-105 text-sm" : "max-w-full text-xs"}`}
    >
      <p className="flex items-start gap-1.5 text-left text-danger">
        <Warning size={size === "sm" ? 14 : 12} className="mt-0.5 shrink-0" />
        {terminationNotice(
          "This agent",
          agent.podTerminationCode,
          reason,
          agent.vm,
        )}
      </p>
      {consoleTail && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-left font-mono text-2xs text-muted-foreground">
          {consoleTail}
        </pre>
      )}
    </div>
  );
}
