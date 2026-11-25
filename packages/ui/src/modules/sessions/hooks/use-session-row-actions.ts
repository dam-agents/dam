import { TELEMETRY_MAX_SINCE_HOURS } from "api-server-api";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useActWhenAwake } from "../../agents/hooks/use-act-when-awake.js";
import { useInstallCapabilities } from "../../features/api/queries.js";
import { downloadTelemetryExport } from "../../telemetry/api/download-export.js";
import { forgetSessionPin } from "../api/session-pins.js";
import { useConfirmDeleteSession } from "./use-confirm-delete-session.js";

export interface SessionRowActions {
  rename: (session: SessionView) => void;
  delete: (session: SessionView) => Promise<void>;
  exportTimeline: ((session: SessionView) => void) | undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a sidebar Session row's menu does, the same
 * in every list. Rename and Delete wake a sleeping Agent and run once it
 * answers, so the Agent still decides; Delete asks its confirmation before
 * the wake. Export telemetry is offered only where the install has a
 * telemetry backend. A deleted Session's pin goes with it, so it leaves
 * Pinned at once.
 */
export function useSessionRowActions(
  agentId: string,
  onRename: (session: SessionView) => void,
): SessionRowActions {
  const deleteSession = useStore((s) => s.deleteSession);
  const confirmDelete = useConfirmDeleteSession();
  const actWhenAwake = useActWhenAwake(agentId);
  const telemetryEnabled =
    useInstallCapabilities().data?.telemetryBackend ?? false;
  return {
    rename: (session) =>
      actWhenAwake(`rename:${session.sessionId}`, () => onRename(session)),
    delete: async (session) => {
      if (await confirmDelete(session))
        actWhenAwake(`delete:${session.sessionId}`, async () => {
          if (await deleteSession(session.sessionId, agentId))
            forgetSessionPin({ agentId, sessionId: session.sessionId });
        });
    },
    exportTimeline: telemetryEnabled
      ? (session) =>
          void downloadTelemetryExport({
            agentId,
            sessionId: session.sessionId,
            signal: "logs",
            sinceHours: TELEMETRY_MAX_SINCE_HOURS,
          })
      : undefined,
  };
}
