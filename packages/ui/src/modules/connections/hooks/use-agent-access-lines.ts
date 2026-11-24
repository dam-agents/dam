import type { ConnectionView } from "api-server-api";
import { useMemo } from "react";

import {
  type AccessSummary,
  accessSummary,
  byRisk,
} from "../lib/grant-tool-access.js";
import type { ConnectionHolder } from "./use-connection-holders.js";
import { useToolApprovalOffered } from "./use-tool-approval-offered.js";

export interface AgentAccessLine {
  agent: ConnectionHolder;
  summary?: AccessSummary;
}

export interface AgentAccessLines {
  lines: readonly AgentAccessLine[];
  writing: number;
}

// UNIT_BOUNDARY_DESCRIPTION: the agents that use a connection on the Connections page, each with what its own grant lets it do, the ones that write without asking first. Null while the `mcp-tool-approval` feature is off, and for a connection none of whose grants carries tool access, where the row keeps its list of names.
export function useAgentAccessLines(
  connection: Pick<ConnectionView, "toolAccess">,
  holders: readonly ConnectionHolder[] | undefined,
): AgentAccessLines | null {
  const offered = useToolApprovalOffered();
  const tools = connection.toolAccess?.tools ?? null;
  return useMemo(() => {
    if (!offered || !holders?.some((h) => h.toolAccess)) return null;
    const lines = holders
      .map((agent) => ({
        agent,
        ...(agent.toolAccess && {
          summary: accessSummary(agent.toolAccess, tools),
        }),
      }))
      .sort((a, b) => byRisk(a.summary, b.summary));
    const writing = lines.filter((l) => l.summary?.tone === "writes").length;
    return { lines, writing };
  }, [offered, holders, tools]);
}
