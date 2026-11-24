import { TrashCan, WarningAlt } from "@carbon/icons-react";
import type { ConnectionStatus, ConnectionView } from "api-server-api";
import { useState } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useAgentAccessLines } from "../hooks/use-agent-access-lines.js";
import type { ConnectionHolder } from "../hooks/use-connection-holders.js";
import { childCardLabel, REFUSED_ACCESS } from "../lib/github-card.js";
import type { AccessSummary } from "../lib/grant-tool-access.js";
import { WritesWithoutAskingMarks } from "./access-summary-label.js";
import { AgentAccessList, AgentAccessToggle } from "./agent-access-list.js";
import { ConnectionIcon } from "./connection-icon.js";
import {
  ConnectionRowActions,
  ConnectionRowMenu,
} from "./connection-row-actions.js";
import { ConnectionRowDetail } from "./connection-row-detail.js";
import { ConnectionUsedBy } from "./connection-used-by.js";
import { FullAccessMark } from "./full-access-mark.js";
import { RetiredHostNote } from "./retired-host-note.js";

export interface RowGrantControls {
  granted: boolean;
  onToggle: (on: boolean) => void;
  actionHidden?: boolean;
  blockedReason?: string;
}

export interface RowToolAccess {
  summary: AccessSummary;
  onEdit?: () => void;
}

export interface RowMaintenanceActions {
  onReauthenticate?: () => void;
  onUpdateCredential?: () => void;
  onEditScope?: () => void;
  onMoveHost?: () => void;
  onRotateKey?: () => void;
  busy?: boolean;
}

const STATUS_PRESENTATION: Record<
  Exclude<ConnectionStatus, "active">,
  { label: string; variant: BadgeProps["variant"] }
> = {
  pending: { label: "Authorizing…", variant: "muted" },
  expired: { label: "Expired", variant: "danger" },
  disconnected: { label: "Disconnected", variant: "muted" },
};

export interface CardRowState {
  paused?: string;
}

interface Props {
  connection: ConnectionView;
  tag: string;
  inCard?: CardRowState;
  usedBy?: readonly ConnectionHolder[];
  iconSlug?: string;
  grant?: RowGrantControls;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  maintenance?: RowMaintenanceActions;
  onRemove?: () => void;
  toolAccess?: RowToolAccess;
}

export function CatalogConnectionRow({
  connection,
  tag,
  inCard,
  usedBy,
  iconSlug,
  grant,
  onManage,
  onDelete,
  deleting = false,
  maintenance,
  onRemove,
  toolAccess,
}: Props) {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const agentAccess = useAgentAccessLines(connection, usedBy);
  const label = childCardLabel(connection);
  const paused = inCard?.paused;
  const refused =
    inCard !== undefined && !paused && connection.status === "expired";
  const note = paused ?? (refused ? REFUSED_ACCESS : undefined);
  const subtitle = [label?.subtitle, note].filter(Boolean).join(" · ");
  return (
    <div
      data-testid={`catalog-connection-${connection.id}`}
      data-paused={paused ? "true" : undefined}
      className={cn(
        "@container flex items-start gap-2 px-4 py-2.5",
        inCard && "pl-14",
      )}
    >
      {iconSlug && (
        <ConnectionIcon
          iconSlug={iconSlug}
          alt=""
          size={16}
          className="mt-2 shrink-0 text-foreground/80"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <div className="flex min-h-8 min-w-0 flex-[1_1_180px] flex-wrap content-center items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "min-w-0 max-w-full truncate text-md font-medium",
                paused ? "text-muted-foreground" : "text-foreground",
              )}
              title={label?.title ?? connection.name}
              data-testid={`catalog-connection-title-${connection.id}`}
            >
              {label?.title ?? connection.name}
            </span>
            {tag && !label && (
              <Badge
                variant="muted"
                className="min-w-0 max-w-full font-normal"
                title={tag}
              >
                <span className="truncate">{tag}</span>
              </Badge>
            )}
            {inCard ? (
              <CardStatusMarks connection={connection} paused={!!paused} />
            ) : (
              <StatusBadges connection={connection} />
            )}
            <WritesWithoutAskingMarks
              connectionId={connection.id}
              grant={toolAccess?.summary}
              agentsWriting={agentAccess?.writing ?? 0}
            />
          </div>
          {!paused && (
            <ConnectionRowActions
              connection={connection}
              grant={grant}
              maintenance={maintenance}
              chooseAccessAgain={refused}
              toolAccess={toolAccess}
              usedBy={
                agentAccess ? (
                  <AgentAccessToggle
                    connectionId={connection.id}
                    count={agentAccess.lines.length}
                    open={agentsOpen}
                    onToggle={() => setAgentsOpen((was) => !was)}
                  />
                ) : (
                  usedBy && (
                    <ConnectionUsedBy
                      connectionId={connection.id}
                      agents={usedBy}
                    />
                  )
                )
              }
            />
          )}
        </div>
        {label ? (
          <p
            className="mt-0.5 break-words text-xs text-muted-foreground"
            title={subtitle}
            data-testid={`catalog-connection-account-${connection.id}`}
          >
            {subtitle}
          </p>
        ) : (
          <>
            <ConnectionRowDetail
              connection={connection}
              grantAccess={toolAccess?.summary.text}
            />
            {note && (
              <p
                className="mt-0.5 break-words text-xs text-muted-foreground"
                data-testid={`catalog-connection-note-${connection.id}`}
              >
                {note}
              </p>
            )}
          </>
        )}
        {!paused && <RetiredHostNote connection={connection} />}
        {agentAccess && agentsOpen && (
          <AgentAccessList connection={connection} lines={agentAccess.lines} />
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1">
        <ConnectionRowMenu
          connection={connection}
          grant={grant}
          maintenance={maintenance}
          onManage={onManage}
          onDelete={onDelete}
          deleting={deleting}
        />
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${connection.name} from this agent`}
            tooltip="Remove from this agent"
            onClick={onRemove}
            data-testid={`catalog-remove-${connection.id}`}
          >
            <TrashCan size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}

export function WarningMark({
  label,
  testId,
}: {
  label: string;
  testId?: string;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-danger"
      data-testid={testId}
    >
      <WarningAlt size={12} aria-hidden />
      {label}
    </span>
  );
}

function CardStatusMarks({
  connection,
  paused,
}: {
  connection: ConnectionView;
  paused: boolean;
}) {
  return (
    <>
      <FullAccessMark connection={connection} tone="warning" />
      {!paused && connection.status !== "active" && (
        <WarningMark
          label={STATUS_PRESENTATION[connection.status].label}
          testId={`catalog-connection-${connection.status}-${connection.id}`}
        />
      )}
      {!paused && <CheckFailedMark connection={connection} />}
    </>
  );
}

export function CheckFailedMark({
  connection,
}: {
  connection: ConnectionView;
}) {
  if (connection.status !== "active" || connection.check?.status !== "failed")
    return null;
  return (
    <span title={connection.check.reason} className="inline-flex shrink-0">
      <WarningMark
        label="Check failed"
        testId={`catalog-connection-check-${connection.id}`}
      />
    </span>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a connection's status beside its name: Authorizing…, Expired or Disconnected, or the full-access mark that carries it. */
export function StatusBadges({ connection }: { connection: ConnectionView }) {
  const status =
    connection.status === "active"
      ? undefined
      : STATUS_PRESENTATION[connection.status];
  if (connection.fullAccess && status)
    return <FullAccessMark connection={connection} status={status.label} />;
  return (
    <>
      <FullAccessMark connection={connection} />
      {status && (
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      )}
      {connection.status === "active" &&
        connection.check?.status === "failed" && (
          <Badge
            variant="danger"
            className="shrink-0"
            title={connection.check.reason}
            data-testid={`catalog-connection-check-${connection.id}`}
          >
            Check failed
          </Badge>
        )}
    </>
  );
}
