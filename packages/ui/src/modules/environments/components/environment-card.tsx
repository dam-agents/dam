import { Launch, TrashCan } from "@carbon/icons-react";
import type { EnvironmentView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { timeUntil } from "../../../lib/format-time.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import {
  useDeleteEnvironment,
  useExtendEnvironment,
} from "../api/mutations.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXTEND_CHOICES = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

// UNIT_BOUNDARY_DESCRIPTION: what the card says of an Environment's machine: running, or not, which covers asleep, starting and every other state; the owner opens its link to wake it.
export function environmentStateLabel(state: string): string {
  return state === "running" ? "Running" : "Not running";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One of an agent's Environments as its owner sees
 * it, as a row of the agent's Environments list: each endpoint's address as a
 * link, whether it runs, when it expires, who may open it, and the owner's
 * controls — extend the expiry and delete it.
 */
export function EnvironmentCard({
  environment,
}: {
  environment: EnvironmentView;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const extend = useExtendEnvironment();
  const remove = useDeleteEnvironment();
  const running = environment.state === "running";

  const handleExtend = (days: number) =>
    extend.mutate(
      {
        id: environment.id,
        expiresAt: new Date(Date.now() + days * DAY_MS).toISOString(),
      },
      {
        onSuccess: (updated) =>
          emitToast({
            kind: "success",
            message: `${environment.name} now expires ${timeUntil(updated.expiresAt)}.`,
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
    <div
      className="flex flex-col gap-3"
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
            tooltip="Delete"
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
    </div>
  );
}
