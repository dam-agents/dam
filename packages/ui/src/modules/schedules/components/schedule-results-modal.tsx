import { Launch, Renew } from "@carbon/icons-react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-time";

import type { Schedule, SessionView } from "../../../types.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { AgentStoppedCallout } from "../../agents/components/agent-stopped-callout.js";
import { useOperableState } from "../../agents/hooks/use-operable-state.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { useScheduleSessions } from "../api/queries.js";
import { formatRunTime, lastRunStatus } from "../lib/schedule-format.js";

interface RowProps {
  session: SessionView;
  onOpen: () => void;
}

function ResultRow({ session, onOpen }: RowProps) {
  const summary = session.title || session.sessionId.slice(0, 12);
  const when = formatDateTime(session.updatedAt ?? session.createdAt);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 not-first:border-t not-first:border-border px-5 py-3 text-left hover:bg-muted md:px-6"
    >
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {summary}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">{when}</span>
      <Launch size={14} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function LastRunLine({ schedule }: { schedule: Schedule }) {
  const lastRun = schedule.status?.lastRun;
  if (!lastRun) return null;
  const status = lastRunStatus(schedule.status?.lastResult);
  return (
    <p className="px-5 pb-4 text-sm text-muted-foreground md:px-6">
      Last run {formatRunTime(lastRun)}
      {status && <span className={status.className}> — {status.label}</span>}
    </p>
  );
}

interface Props {
  agentId: string;
  schedule: Schedule;
  onClose: () => void;
  onResumeSession?: (sessionId: string) => void;
}

export function ScheduleResultsModal({
  agentId,
  schedule,
  onClose,
  onResumeSession,
}: Props) {
  const { comingUp } = useOperableState(agentId);
  const runState = useAgentRunState(agentId);
  const stopped = runState !== undefined && runState !== "running";
  const wakeAgent = useWakeAgent();
  const sessionsQuery = useScheduleSessions(
    stopped ? null : agentId,
    schedule.id,
  );
  const sessions = sessionsQuery.data ?? [];

  const subtitle = stopped
    ? "Past runs are recorded in the agent"
    : sessionsQuery.isPending
      ? "Loading runs…"
      : sessionsQuery.isError
        ? "Couldn't load runs"
        : `${sessions.length} session${sessions.length === 1 ? "" : "s"} recorded`;

  return (
    <Modal>
      <DialogHeader
        title={schedule.name}
        truncateTitle
        subtitle={subtitle}
        onClose={onClose}
      />
      <DialogBody flush className="min-h-[50vh]">
        {stopped && (
          <>
            <div className="px-5 py-4 md:px-6">
              <AgentStoppedCallout
                comingUp={comingUp}
                onStart={() => wakeAgent.wake(agentId)}
              >
                — Start the agent to see runs.
              </AgentStoppedCallout>
            </div>
            <LastRunLine schedule={schedule} />
          </>
        )}
        {!stopped && sessionsQuery.isError && (
          <div className="flex flex-col items-center gap-3 px-5 py-6 md:px-6">
            <p className="text-center text-sm text-muted-foreground">
              Couldn&rsquo;t read past runs from the agent.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sessionsQuery.refetch()}
              disabled={sessionsQuery.isFetching}
            >
              <Renew size={14} /> Try again
            </Button>
          </div>
        )}
        {!stopped &&
          !sessionsQuery.isPending &&
          !sessionsQuery.isError &&
          sessions.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground md:px-6">
              No runs yet.
            </p>
          )}
        {sessions.map((session) => (
          <ResultRow
            key={session.sessionId}
            session={session}
            onOpen={() => {
              onResumeSession?.(session.sessionId);
              onClose();
            }}
          />
        ))}
      </DialogBody>
    </Modal>
  );
}
