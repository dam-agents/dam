import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { egressApprovalsWaiting } from "../../approvals/lib/waiting-egress.js";
import { useOutageFor } from "../../provider-status/api/queries.js";
import { quietTurnCopy, quietTurnOf } from "../lib/quiet-turn.js";
import { StatusLine } from "./status-line.js";

const TICK_MS = 15_000;

export function QuietTurnLine({ templateId }: { templateId: string | null }) {
  const agentId = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const messages = useStore((s) => s.messages);
  const lastOutputAt = useStore((s) => s.lastOutputAt);
  const askingPermission = useStore((s) =>
    s.pendingPermissions.some((p) => p.sessionId === sessionId),
  );
  const { data: approvals = [] } = useApprovalsForAgent(agentId);
  const outage = useOutageFor(templateId);
  const now = useNow(TICK_MS);

  if (askingPermission || outage.kind !== "no-outage") return null;
  if (agentId && egressApprovalsWaiting(approvals, agentId, now).length > 0)
    return null;
  const quiet = quietTurnOf({ messages, lastOutputAt, now });
  if (quiet === null) return null;
  const copy = quietTurnCopy(quiet);
  return (
    <StatusLine testId="quiet-turn-line" tone={copy.tone}>
      <span className="min-w-0 truncate py-2">
        <span className="font-semibold text-foreground">{copy.lead}</span>{" "}
        <span className="text-muted-foreground">{copy.rest}</span>
      </span>
    </StatusLine>
  );
}
