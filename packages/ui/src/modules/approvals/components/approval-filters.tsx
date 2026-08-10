import type { ApprovalView } from "api-server-api";
import { useMemo } from "react";

import { Select } from "@/components/ui/select";

import { useAgentsList } from "../../agents/api/queries.js";

export type ApprovalTypeFilter = "all" | "network" | "tool";
export type VerdictFilter = "all" | "allowed" | "denied";

interface ApprovalFiltersProps {
  agentFilter: string;
  onAgentFilterChange: (value: string) => void;
  typeFilter: ApprovalTypeFilter;
  onTypeFilterChange: (value: ApprovalTypeFilter) => void;
  verdictFilter?: VerdictFilter;
  onVerdictFilterChange?: (value: VerdictFilter) => void;
  rows: readonly ApprovalView[];
}

export function ApprovalFilters({
  agentFilter,
  onAgentFilterChange,
  typeFilter,
  onTypeFilterChange,
  verdictFilter,
  onVerdictFilterChange,
  rows,
}: ApprovalFiltersProps) {
  const agents = useAgentsList();

  const agentIds = useMemo(() => {
    const ids = new Set(rows.map((r) => r.agentId));
    return [...ids];
  }, [rows]);

  const agentOptions = useMemo(
    () =>
      agentIds.map((id) => ({
        id,
        name: agents.find((a) => a.id === id)?.name ?? id,
      })),
    [agentIds, agents],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Select
        size="sm"
        value={agentFilter}
        onChange={(e) => onAgentFilterChange(e.target.value)}
        aria-label="Filter by sandbox"
      >
        <option value="all">All sandboxes</option>
        {agentOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>

      <Select
        size="sm"
        value={typeFilter}
        onChange={(e) =>
          onTypeFilterChange(e.target.value as ApprovalTypeFilter)
        }
        aria-label="Filter by type"
      >
        <option value="all">All types</option>
        <option value="network">Network</option>
        <option value="tool">Tool</option>
      </Select>

      {verdictFilter !== undefined && onVerdictFilterChange && (
        <Select
          size="sm"
          value={verdictFilter}
          onChange={(e) =>
            onVerdictFilterChange(e.target.value as VerdictFilter)
          }
          aria-label="Filter by verdict"
        >
          <option value="all">All verdicts</option>
          <option value="allowed">Allowed</option>
          <option value="denied">Denied</option>
        </Select>
      )}
    </div>
  );
}

export function filterApprovals(
  rows: readonly ApprovalView[],
  agentFilter: string,
  typeFilter: ApprovalTypeFilter,
  verdictFilter?: VerdictFilter,
): ApprovalView[] {
  let filtered = [...rows];

  if (agentFilter !== "all") {
    filtered = filtered.filter((r) => r.agentId === agentFilter);
  }

  if (typeFilter === "network") {
    filtered = filtered.filter((r) => r.type === "ext_authz");
  } else if (typeFilter === "tool") {
    filtered = filtered.filter((r) => r.type === "acp_native");
  }

  if (verdictFilter === "allowed") {
    filtered = filtered.filter(
      (r) => r.verdict === "allow_once" || r.verdict === "allow",
    );
  } else if (verdictFilter === "denied") {
    filtered = filtered.filter(
      (r) => r.verdict === "deny_once" || r.verdict === "deny",
    );
  }

  return filtered;
}
