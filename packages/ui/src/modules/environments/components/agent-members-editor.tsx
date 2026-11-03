import { Add } from "@carbon/icons-react";
import type { EnvironmentMemberAgent } from "api-server-api";
import { VIEWER_ALLOWLIST_MAX } from "api-server-api";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { timeAgo } from "@/lib/format-time";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

// UNIT_BOUNDARY_DESCRIPTION: an Agent on a list as the editor holds it: what the server said of it, or, for one just added, what its lookup said.
export type ListedAgent = Pick<
  EnvironmentMemberAgent,
  "agentId" | "name" | "ownerName"
> & { lastOpenedAt?: string | null };

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agents on an Environment list, of any
 * owner, beside its people. An Agent is added by its id, which the server
 * looks up first, so the list shows whose Agent it is before it is saved and
 * an id that names no Agent is never added. Each row says the Agent's name,
 * its owner and when it last opened what the list covers.
 */
export function AgentMembersEditor({
  agents,
  onChange,
  disabled,
  draft,
  onDraftChange,
}: {
  agents: ListedAgent[];
  onChange: (agents: ListedAgent[]) => void;
  disabled: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
}) {
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const full = agents.length >= VIEWER_ALLOWLIST_MAX;

  async function handleAdd() {
    const id = draft.trim();
    if (disabled || full || id === "" || looking) return;
    if (agents.some((a) => a.agentId === id)) {
      setError("This agent is already on the list");
      return;
    }
    setLooking(true);
    try {
      const found = await queryClient.fetchQuery(
        trpc.environments.lookupAgent.queryOptions({ agentId: id }),
      );
      if (!found.found) {
        setError("That id names no agent that can open an Environment");
        return;
      }
      onChange([
        ...agents,
        { agentId: found.agentId, name: found.name, ownerName: found.ownerName },
      ]);
      onDraftChange("");
      setError(null);
    } catch {
      setError("Couldn't look the agent up. Try again.");
    } finally {
      setLooking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="agent-members">
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          placeholder="agent-…"
          aria-label="Agent id"
          value={draft}
          variant={error ? "invalid" : "standard"}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          disabled={disabled || full}
          onChange={(e) => {
            onDraftChange(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
          data-testid="agent-member-input"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || full || looking || draft.trim().length === 0}
          onClick={() => void handleAdd()}
        >
          <Add size={16} /> Add
        </Button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {agents.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agents. An agent&apos;s id is on its page; add it to let that
          agent open this from its sandbox.
        </p>
      ) : (
        <ul className="-ml-1 max-h-32 overflow-y-auto pr-1" data-testid="agent-member-list">
          {agents.map((a) => (
            <li
              key={a.agentId}
              className="flex items-center justify-between gap-2 rounded-md py-1 pl-1 pr-0.5 hover:bg-muted/40"
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 truncate text-sm text-foreground">
                  <Badge size="sm" variant="muted">
                    Agent
                  </Badge>
                  <span className="truncate">
                    {a.name}
                    {a.ownerName ? ` · ${a.ownerName}` : ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {lastOpened(a)}
                </span>
              </span>
              <RemoveButton
                label={`Remove ${a.name}`}
                tooltip="Remove"
                disabled={disabled}
                onClick={() => onChange(agents.filter((x) => x.agentId !== a.agentId))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function lastOpened(agent: ListedAgent): string {
  if (agent.lastOpenedAt === undefined) return "Added, not saved yet";
  if (agent.lastOpenedAt === null) return "Not opened yet";
  return `Last opened ${timeAgo(agent.lastOpenedAt)}`;
}

// UNIT_BOUNDARY_DESCRIPTION: whether two Agent lists name the same Agents, in any order.
export function sameAgents(
  a: readonly { agentId: string }[],
  b: readonly { agentId: string }[],
): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((x) => x.agentId));
  return b.every((x) => ids.has(x.agentId));
}
