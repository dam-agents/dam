import { Add } from "@carbon/icons-react";
import type { EnvironmentMemberAgent } from "api-server-api";
import { VIEWER_ALLOWLIST_MAX } from "api-server-api";
import { useCallback, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { timeAgo } from "@/lib/format-time";

import { useLookupAgent } from "../api/queries.js";

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
 * its owner and when it last opened what the list covers. It reports one
 * addition or removal at a time, never a whole list, so a lookup that
 * resolves after another edit, or a list polled meanwhile, loses nothing.
 */
export function AgentMembersEditor({
  agents,
  onAdd,
  onRemove,
  disabled,
  draft,
  onDraftChange,
}: {
  agents: ListedAgent[];
  onAdd: (agent: ListedAgent) => void;
  onRemove: (agentId: string) => void;
  disabled: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
}) {
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const lookupAgent = useLookupAgent();
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
      const found = await lookupAgent(id);
      if (!found.found) {
        setError("That id names no agent that can open an Environment");
        return;
      }
      onAdd({
        agentId: found.agentId,
        name: found.name,
        ownerName: found.ownerName,
      });
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
          disabled={disabled || full || looking}
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
          No agents. An agent&apos;s id is on its page; add it to let that agent
          open this from its sandbox.
        </p>
      ) : (
        <ul
          className="-ml-1 max-h-32 overflow-y-auto pr-1"
          data-testid="agent-member-list"
        >
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
                onClick={() => onRemove(a.agentId)}
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

interface AgentEdits {
  added: readonly ListedAgent[];
  removed: readonly string[];
}

const NO_AGENT_EDITS: AgentEdits = { added: [], removed: [] };

/**
 * UNIT_BOUNDARY_DESCRIPTION: A person's edits to an Agent list, held as
 * Agents added and removed and applied to the list as last polled, so an
 * Agent someone else added while the editor is open shows up and stays
 * through a Save. Each edit is applied to the edits as they stand, never to a
 * copy taken before a lookup.
 */
export function useAgentEdits(live: readonly ListedAgent[]) {
  const [edits, setEdits] = useState<AgentEdits>(NO_AGENT_EDITS);
  const agents = [
    ...live.filter((a) => !edits.removed.includes(a.agentId)),
    ...edits.added.filter((a) => !live.some((l) => l.agentId === a.agentId)),
  ];
  const onAdd = useCallback(
    (agent: ListedAgent) =>
      setEdits((e) => ({
        added: [...e.added.filter((a) => a.agentId !== agent.agentId), agent],
        removed: e.removed.filter((id) => id !== agent.agentId),
      })),
    [],
  );
  const onRemove = useCallback(
    (agentId: string) =>
      setEdits((e) => ({
        added: e.added.filter((a) => a.agentId !== agentId),
        removed: e.removed.includes(agentId)
          ? e.removed
          : [...e.removed, agentId],
      })),
    [],
  );
  const reset = useCallback(() => setEdits(NO_AGENT_EDITS), []);
  return {
    agents,
    dirty: !sameAgents(agents, live),
    onAdd,
    onRemove,
    reset,
  };
}
