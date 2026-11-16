import { Add, Information } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";

import { githubCredentialKind } from "../lib/github-access.js";
import {
  parentCardLead,
  parentRepair,
  signInAppLabel,
} from "../lib/github-card.js";
import {
  CatalogConnectionRow,
  CheckFailedMark,
  WarningMark,
} from "./catalog-connection-row.js";
import { type ConnectionRowControls, usedByOf } from "./connection-row.js";
import { ConnectionRowMenu } from "./connection-row-actions.js";
import { GithubAppInstallations } from "./github-app-installations.js";
import { RetiredHostNote } from "./retired-host-note.js";

interface Props extends ConnectionRowControls {
  parent: ConnectionView;
  title: string;
  childConnections: readonly ConnectionView[];
  onNewChild?: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The card of one GitHub sign-in or GitHub App
 * installation. Its header says which account or app holds the credential
 * and how it was made, and never anything about agents: no agent can hold
 * the credential itself. Its rows are the connections made from it, each read
 * by what it reaches, since those are what an agent holds. A broken sign-in
 * or installation shows what is wrong and the one fix on the header, in place
 * of New connection, and its rows turn grey and say they are paused until the
 * fix is made.
 */
export function ParentConnectionBlock({
  parent,
  title,
  childConnections,
  onNewChild,
  ...controls
}: Props) {
  const { templateById, onDelete, deletingId, maintenance, holders } = controls;
  const parentMaintenance = maintenance?.(parent);
  const repair = parentRepair(parent, parentMaintenance);
  const signIn = githubCredentialKind(parent) === "sign-in";
  const appLabel = signIn
    ? signInAppLabel(parent, templateById.get(parent.templateId))
    : undefined;
  return (
    <div
      data-testid={`connection-parent-${parent.id}`}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="@container flex items-start gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
        >
          {title.charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-[1_1_220px]">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h4
                className="min-w-0 max-w-full truncate text-md font-medium text-foreground"
                title={title}
                data-testid={`connection-parent-title-${parent.id}`}
              >
                {title}
              </h4>
              {repair && (
                <WarningMark
                  label={repair.badge}
                  testId={`connection-parent-status-${parent.id}`}
                />
              )}
              <CheckFailedMark connection={parent} />
            </div>
            <div
              className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground"
              data-testid={`connection-parent-lead-${parent.id}`}
            >
              <span>{parentCardLead(parent)}</span>
              {appLabel && (
                <GithubAppInstallations
                  connection={parent}
                  appLabel={appLabel}
                />
              )}
            </div>
            <RetiredHostNote connection={parent} />
          </div>
          <div className="ml-auto flex shrink-0 items-center empty:hidden">
            {repair
              ? repair.fix && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={parentMaintenance?.busy}
                    onClick={repair.fix.run}
                    data-testid={`catalog-fix-${parent.id}`}
                  >
                    {repair.fix.label}
                  </Button>
                )
              : onNewChild && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={onNewChild}
                    data-testid={`connection-new-child-${parent.id}`}
                  >
                    New connection
                    <Add size={16} />
                  </Button>
                )}
          </div>
        </div>
        <div className="flex h-8 shrink-0 items-center">
          <ConnectionRowMenu
            connection={parent}
            maintenance={parentMaintenance}
            onDelete={onDelete && (() => onDelete(parent.id, parent.name))}
            deleting={deletingId === parent.id}
          />
        </div>
      </header>
      {childConnections.length > 0 ? (
        <div className="py-1" data-testid={`connection-children-${parent.id}`}>
          {childConnections.map((child) => (
            <CatalogConnectionRow
              key={child.id}
              connection={child}
              tag=""
              inCard={{ paused: repair?.paused }}
              usedBy={usedByOf(holders, child.id)}
              grant={controls.grant?.(child)}
              onManage={controls.onManage}
              onDelete={onDelete && (() => onDelete(child.id, child.name))}
              deleting={deletingId === child.id}
              maintenance={maintenance?.(child)}
            />
          ))}
        </div>
      ) : (
        <NoChildrenRow parent={parent} broken={repair !== null} />
      )}
    </div>
  );
}

function NoChildrenRow({
  parent,
  broken,
}: {
  parent: ConnectionView;
  broken: boolean;
}) {
  const noun =
    githubCredentialKind(parent) === "sign-in" ? "sign-in" : "installation";
  return (
    <p
      className="flex items-start gap-1.5 py-3 pl-14 pr-4 text-xs text-muted-foreground"
      data-testid={`connection-parent-empty-${parent.id}`}
    >
      <Information size={12} aria-hidden className="mt-0.5 shrink-0" />
      <span>
        No agent can use this {noun} yet.
        {!broken && " Make a connection from it and choose what it reaches."}
      </span>
    </p>
  );
}
