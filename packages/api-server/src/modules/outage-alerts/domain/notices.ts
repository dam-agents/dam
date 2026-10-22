import type { OutageAlertNotice } from "api-server-api";

import type { OutageAlert } from "./alert-rules.js";

export function noticeOf(alert: OutageAlert): OutageAlertNotice {
  const since = alert.since.toISOString();
  return {
    id: `${alert.templateId}:${since}:${alert.state}`,
    templateId: alert.templateId,
    since,
    recoveredAt: alert.recoveredAt?.toISOString() ?? null,
    statusPageUrl: alert.statusPageUrl,
    agents: alert.agents.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      affectedBy: [...agent.affectedBy],
    })),
  };
}
