import { WarningAlt } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { parentNoun } from "../lib/connection-hierarchy.js";
import { ConnectionRow, type ConnectionRowControls } from "./connection-row.js";
import { ConnectionRowCard } from "./connection-row-card.js";

interface Props extends ConnectionRowControls {
  parent: ConnectionView;
  childConnections: readonly ConnectionView[];
  onNewChild?: () => void;
}

export function ParentConnectionBlock({
  parent,
  childConnections,
  onNewChild,
  ...controls
}: Props) {
  const {
    templateById,
    bare = false,
    onDelete,
    deletingId,
    maintenance,
  } = controls;
  const active = parent.status === "active";
  return (
    <div
      data-testid={`connection-parent-${parent.id}`}
      className={cn(!bare && "rounded-lg border border-border")}
    >
      <ConnectionRowCard
        bare
        connection={parent}
        template={templateById.get(parent.templateId)}
        onDelete={onDelete && (() => onDelete(parent.id, parent.name))}
        deleting={deletingId === parent.id}
        maintenance={maintenance?.(parent)}
        onNewChild={active ? onNewChild : undefined}
      />
      {childConnections.length > 0 ? (
        <div
          className="mb-2 ml-6 divide-y divide-border border-l-2 border-border"
          data-testid={`connection-children-${parent.id}`}
        >
          {childConnections.map((child) => (
            <ConnectionRow
              key={child.id}
              connection={child}
              {...controls}
              bare
            />
          ))}
        </div>
      ) : (
        active && <NoChildrenCallout parent={parent} onNewChild={onNewChild} />
      )}
    </div>
  );
}

function NoChildrenCallout({
  parent,
  onNewChild,
}: {
  parent: ConnectionView;
  onNewChild?: () => void;
}) {
  return (
    <div
      className="mx-4 mb-2.5 ml-10 flex flex-wrap items-center gap-x-3 gap-y-1.5"
      data-testid={`connection-parent-empty-${parent.id}`}
    >
      <p className="flex min-w-0 flex-[1_1_240px] items-start gap-1.5 text-xs text-muted-foreground">
        <WarningAlt
          size={12}
          aria-hidden
          className="mt-0.5 shrink-0 text-warning"
        />
        <span>
          No agent can use this {parentNoun(parent)} yet. Make a connection from
          it and choose what that connection reaches.
        </span>
      </p>
      {onNewChild && (
        <Button
          variant="outline"
          size="xs"
          className="ml-auto shrink-0"
          onClick={onNewChild}
          data-testid={`connection-choose-reach-${parent.id}`}
        >
          Choose what it reaches
        </Button>
      )}
    </div>
  );
}
