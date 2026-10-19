import { Launch, TrashCan } from "@carbon/icons-react";
import type { EnvironmentView } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { timeUntil } from "../../../lib/format-time.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  useDeleteEnvironment,
  useExtendEnvironment,
  useToggleEnvironmentConnection,
} from "../api/mutations.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXTEND_CHOICES = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

export function environmentStateLabel(state: string): string {
  if (state === "running") return "Running";
  if (state === "hibernated") return "Asleep";
  if (state === "starting" || state === "preparing_workspace")
    return "Starting";
  if (state === "pausing") return "Going to sleep";
  return state;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One of an agent's Environments as its owner sees
 * it: each endpoint's address as a link, whether it runs or sleeps, when it
 * expires, who may open it, and the owner's controls — extend the expiry,
 * delete it, and grant or remove a connection on it, which only the owner can
 * do.
 */
export function EnvironmentCard({
  environment,
}: {
  environment: EnvironmentView;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const extend = useExtendEnvironment();
  const remove = useDeleteEnvironment();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const running = environment.state === "running";

  const handleExtend = (days: number) =>
    extend.mutate(
      {
        id: environment.id,
        expiresAt: new Date(Date.now() + days * DAY_MS).toISOString(),
      },
      {
        onSuccess: () =>
          emitToast({
            kind: "success",
            message: `${environment.name} now expires ${timeUntil(new Date(Date.now() + days * DAY_MS))}.`,
          }),
      },
    );

  const handleDelete = async () => {
    if (
      await showConfirm(
        "Its machine and disk are deleted, and its addresses stop answering. The agent can create it again.",
        `Delete Environment “${environment.name}”?`,
        { kind: "destructive", confirmLabel: "Delete Environment" },
      )
    )
      remove.mutate({ id: environment.id });
  };

  return (
    <Card
      className="flex flex-col gap-3 p-4"
      data-testid="environment-card"
      data-environment={environment.name}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-md font-medium text-foreground">
            {environment.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                running ? "bg-success" : "bg-muted-foreground/40",
              )}
            />
            <span>{environmentStateLabel(environment.state)}</span>
            <span aria-hidden>·</span>
            <span>Expires {timeUntil(environment.expiresAt)}</span>
            <span aria-hidden>·</span>
            <span>
              {environment.access === null
                ? "Your whole list may open it"
                : environment.access.length === 0
                  ? "Only you may open it"
                  : `${environment.access.length} of your list may open it`}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Select
            size="sm"
            aria-label={`Extend ${environment.name}`}
            value=""
            disabled={extend.isPending}
            onChange={(e) => {
              const days = Number(e.target.value);
              if (days > 0) handleExtend(days);
            }}
          >
            <option value="" disabled>
              Extend…
            </option>
            {EXTEND_CHOICES.map((c) => (
              <option key={c.days} value={c.days}>
                {c.label} from now
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete ${environment.name}`}
            disabled={remove.isPending}
            onClick={() => void handleDelete()}
          >
            <TrashCan size={16} />
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-1" data-testid="environment-endpoints">
        {environment.endpoints.map((endpoint) => (
          <li key={endpoint.name} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
              {endpoint.name} · {endpoint.port}
            </span>
            {endpoint.url ? (
              <a
                href={endpoint.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate text-accent hover:underline"
              >
                <span className="truncate">{endpoint.url}</span>
                <Launch size={12} className="shrink-0" />
              </a>
            ) : (
              <span className="text-muted-foreground">
                No address: this install serves no Environments.
              </span>
            )}
          </li>
        ))}
      </ul>

      <div>
        <Button
          variant="link"
          size="inline"
          onClick={() => setConnectionsOpen((o) => !o)}
          aria-expanded={connectionsOpen}
        >
          {connectionsOpen ? "Hide connections" : "Connections"}
        </Button>
        {connectionsOpen && (
          <EnvironmentConnections environmentId={environment.id} />
        )}
      </div>
    </Card>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The connections one Environment holds, none by
 * default, and the owner's switch for each of their connections. Only the
 * owner, here in the app, grants one; the app inside sees only its
 * placeholder.
 */
function EnvironmentConnections({ environmentId }: { environmentId: string }) {
  const owned = useAppConnections();
  const granted = useAgentConnections(environmentId);
  const toggle = useToggleEnvironmentConnection();
  const grantedIds = new Set(
    (granted.data?.connections ?? []).map((c) => c.connectionId),
  );
  const connections = owned.data ?? [];

  return (
    <div
      className="mt-2 flex flex-col gap-1"
      data-testid="environment-connections"
    >
      <p className="text-xs text-muted-foreground">
        An Environment holds no credentials unless you grant one here. Its agent
        cannot.
      </p>
      {connections.length === 0 && (
        <p className="text-sm text-muted-foreground">
          You have no connections.
        </p>
      )}
      {connections.map((connection) => {
        const on = grantedIds.has(connection.id);
        return (
          <label
            key={connection.id}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              checked={on}
              disabled={toggle.isPending || granted.isPending}
              onChange={(e) =>
                toggle.mutate({
                  environmentId,
                  id: connection.id,
                  on: e.target.checked,
                })
              }
            />
            <span className="truncate">{connection.name}</span>
          </label>
        );
      })}
    </div>
  );
}
