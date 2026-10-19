import { ChevronRight, Renew } from "@carbon/icons-react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-time";

import type { Schedule, SessionView } from "../../../types.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { AgentSleepingCallout } from "../../agents/components/agent-sleeping-callout.js";
import { useOperableState } from "../../agents/hooks/use-operable-state.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { useScheduleSessions } from "../api/queries.js";
import { runOutcomeLine } from "../lib/schedule-format.js";

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
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function OutcomeLine({ schedule }: { schedule: Schedule }) {
  const line = runOutcomeLine(schedule);
  if (!line) return null;
  return (
    <p className="px-5 pt-4 pb-4 text-sm text-muted-foreground md:px-6">
      {line.lastRun && (
        <span className="block">{`Last run ${line.lastRun}`}</span>
      )}
      <span className={line.className}>{line.label}</span>
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
    <Modal onClose={onClose}>
      <DialogHeader
        title={schedule.name}
        truncateTitle
        subtitle={subtitle}
        onClose={onClose}
      />
      <DialogBody flush className="min-h-[50vh]">
        <OutcomeLine schedule={schedule} />
        {stopped && (
          <div className="px-5 py-4 md:px-6">
            <AgentSleepingCallout
              comingUp={comingUp}
              onStart={() => wakeAgent.wake(agentId)}
            >
              — Wake the agent to see runs.
            </AgentSleepingCallout>
          </div>
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
              <Renew size={14} /> Retry
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
