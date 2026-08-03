import { Launch } from "@carbon/icons-react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";

import type { Schedule, SessionView } from "../../../types.js";
import { useScheduleSessions } from "../api/queries.js";

interface RowProps {
  session: SessionView;
  onOpen: () => void;
}

function ResultRow({ session, onOpen }: RowProps) {
  const summary = session.title || session.sessionId.slice(0, 12);
  const when = new Date(
    session.updatedAt ?? session.createdAt,
  ).toLocaleString();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-t border-border px-5 py-3 text-left hover:bg-muted md:px-7"
    >
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {summary}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">{when}</span>
      <Launch size={14} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

interface Props {
  agentId: string;
  schedule: Schedule;
  onClose: () => void;
  onResumeSession?: (sessionId: string) => void;
}

/** Lists the sessions a schedule has produced (#943). The contract exposes no
 *  per-run outcome, so each row is the session's own title + timestamp and
 *  opens that session. */
export function ScheduleResultsModal({
  agentId,
  schedule,
  onClose,
  onResumeSession,
}: Props) {
  const sessionsQuery = useScheduleSessions(agentId, schedule.id);
  const sessions = sessionsQuery.data ?? [];

  const subtitle = sessionsQuery.isPending
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
        {sessionsQuery.isError && (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground md:px-7">
            Couldn't load past runs — the agent may be asleep.
          </p>
        )}
        {!sessionsQuery.isPending &&
          !sessionsQuery.isError &&
          sessions.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground md:px-7">
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
