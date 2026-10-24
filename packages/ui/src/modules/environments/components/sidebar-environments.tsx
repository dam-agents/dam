import { Cloud, Launch } from "@carbon/icons-react";
import type { EnvironmentView } from "api-server-api";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useEnvironments, useEnvironmentsEnabled } from "../api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: An agent's Environments in the current layout's
 * sidebar, under the agent that owns them and never as agents: a row each, with whether it
 * runs, that opens the agent's Environments section, and a link per endpoint
 * that opens the app in a new tab. Nothing shows for an agent without
 * Environments, or while the feature is off. JanUI's tree lists none; its
 * chat side panel has an Environments tab instead.
 */
export function SidebarEnvironments({
  agentId,
  indent,
  onNavigate,
}: {
  agentId: string;
  indent: string;
  onNavigate?: () => void;
}) {
  const enabled = useEnvironmentsEnabled();
  const environments = useEnvironments(enabled ? agentId : null);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const list = environments.data ?? [];
  if (list.length === 0) return null;

  return (
    <ul
      className="flex flex-col gap-px"
      aria-label="Environments"
      data-testid="sidebar-environments"
    >
      {list.map((environment) => (
        <EnvironmentRow
          key={environment.id}
          environment={environment}
          indent={indent}
          onOpen={() => {
            navigateToSandboxHome(agentId, "environments");
            onNavigate?.();
          }}
        />
      ))}
    </ul>
  );
}

function EnvironmentRow({
  environment,
  indent,
  onOpen,
}: {
  environment: EnvironmentView;
  indent: string;
  onOpen: () => void;
}) {
  const running = environment.state === "running";
  const links = environment.endpoints.filter((e) => e.url !== null);
  return (
    <li
      className="group/env flex items-center rounded-lg transition-colors hover:bg-muted"
      data-testid="sidebar-environment"
      data-environment={environment.name}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg pr-1 text-left text-sm text-muted-foreground hover:text-foreground",
          indent,
          FOCUS_RING,
        )}
      >
        <Cloud size={14} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{environment.name}</span>
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            running ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
        <span className="sr-only">
          {running ? "(running)" : "(not running)"}
        </span>
      </button>
      {links.map((endpoint) => (
        <Tooltip
          key={endpoint.name}
          content={`Open ${endpoint.name}`}
          side="right"
        >
          <a
            href={endpoint.url!}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${endpoint.name} of ${environment.name}`}
            data-testid="sidebar-environment-link"
            className={cn(
              "mr-1 flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
              FOCUS_RING,
            )}
          >
            {links.length > 1 && <span>{endpoint.name}</span>}
            <Launch size={12} aria-hidden />
          </a>
        </Tooltip>
      ))}
    </li>
  );
}
