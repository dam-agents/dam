import type { ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
          className="mb-3 ml-6 divide-y divide-border border-l-2 border-border"
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
    <Callout
      tone="warning"
      size="sm"
      className="mx-4 mb-3 flex flex-wrap items-center gap-3"
      data-testid={`connection-parent-empty-${parent.id}`}
    >
      <p className="min-w-0 flex-1 text-sm">
        No agent can use this {parentNoun(parent)} yet. Make a connection from
        it and choose what that connection reaches.
      </p>
      {onNewChild && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onNewChild}
          data-testid={`connection-choose-reach-${parent.id}`}
        >
          Choose what it reaches
        </Button>
      )}
    </Callout>
  );
}
