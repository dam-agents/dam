import { Launch } from "@carbon/icons-react";
import type { EnvironmentView } from "api-server-api";
import type { ReactNode } from "react";

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
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

// UNIT_BOUNDARY_DESCRIPTION: who the card says may open an Environment: the owner's whole list, the owner alone, or a part of the list the agent narrowed it to.
export function environmentAccessLabel(access: string[] | null): string {
  if (access === null) return "Your whole list may open it";
  if (access.length === 0) return "Only you may open it";
  return `${access.length} of your list may open it`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One of an agent's Environments as its owner sees
 * it, as a row of the agent's Environments list: each endpoint's address as a
 * link, whether it runs, when it expires, who may open it, and the owner's
 * controls — extend the expiry and delete it — in one menu on the name row.
 * The card brings its own padding, so it looks the same in every list. An
 * endpoint's name, port and address are columns of their own; the name column
 * has a minimum width most names fit (they run to 12 characters), so the
 * addresses start at one x in every card of a list.
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
      className="flex flex-col gap-3 px-4 py-3"
      data-testid="environment-card"
      data-environment={environment.name}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-md font-medium text-foreground"
            title={environment.name}
          >
            {environment.name}
          </p>
          <p
            className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground"
            data-testid="environment-status"
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  running ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
              {environmentStateLabel(environment.state)}
            </span>
            <StatusItem>Expires {timeUntil(environment.expiresAt)}</StatusItem>
            <StatusItem>
              {environmentAccessLabel(environment.access)}
            </StatusItem>
          </p>
        </div>
        <RowActionsMenu
          label={`Actions for ${environment.name}`}
          testId="environment-actions"
          disabled={extend.isPending || remove.isPending}
        >
          <DropdownMenuLabel>Extend to</DropdownMenuLabel>
          {EXTEND_CHOICES.map((c) => (
            <DropdownMenuItem
              key={c.days}
              onSelect={() => handleExtend(c.days)}
            >
              {c.label} from now
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => void handleDelete()}>
            Delete Environment
          </DropdownMenuItem>
        </RowActionsMenu>
      </div>

      <ul
        className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
        data-testid="environment-endpoints"
      >
        {environment.endpoints.map((endpoint) => (
          <li
            key={endpoint.name}
            className="col-span-3 grid grid-cols-subgrid items-center text-sm"
          >
            <span className="min-w-[8ch] whitespace-nowrap font-mono text-xs text-muted-foreground">
              {endpoint.name}
            </span>
            <span className="min-w-[5ch] text-right font-mono text-xs tabular-nums text-muted-foreground">
              {endpoint.port}
            </span>
            {endpoint.url ? (
              <a
                href={endpoint.url}
                target="_blank"
                rel="noreferrer"
                title={endpoint.url}
                className="inline-flex min-w-0 max-w-full items-center gap-1 justify-self-start text-accent hover:underline"
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

// UNIT_BOUNDARY_DESCRIPTION: One item of the status line after the first: its separator travels with it, so the line wraps between items and never inside one.
function StatusItem({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden className="mr-1.5">
        ·
      </span>
      {children}
    </span>
  );
}
