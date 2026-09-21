import { Checkmark, Information } from "@carbon/icons-react";
import type {
  ConnectionTemplateView,
  ConnectionView,
  StarterKitConnectionRequirement,
} from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { RowMaintenanceActions } from "../../connections/components/catalog-connection-row.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { ConnectionRowCard } from "../../connections/components/connection-row-card.js";
import { describeAccepts } from "../lib/setup.js";

interface Props {
  requirement: StarterKitConnectionRequirement;
  granted: readonly ConnectionView[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  templates: readonly ConnectionTemplateView[];
  maintenance: (
    connection: ConnectionView,
  ) => RowMaintenanceActions | undefined;
  onRevoke: (connectionId: string) => void;
  onConnect: (accepts: readonly string[]) => void;
}

function iconSlugFor(
  ids: readonly string[],
  templates: readonly ConnectionTemplateView[],
): string | undefined {
  return templates.find(
    (t) =>
      (ids.includes(t.id) || (t.family && ids.includes(t.family.id))) &&
      t.iconSlug,
  )?.iconSlug;
}

export function KitRequirementRow({
  requirement,
  granted,
  templateById,
  templates,
  maintenance,
  onRevoke,
  onConnect,
}: Props) {
  const slug = iconSlugFor(requirement.accepts, templates);
  const title = describeAccepts(requirement.accepts, templateById);

  return (
    <li
      className="border-t border-kit-rule px-4 py-4 first:border-t-0"
      data-testid={`starter-kit-requirement-${requirement.accepts.join("-")}`}
    >
      <div className="flex items-center gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-kit-tint text-kit">
          {slug ? (
            <ConnectionIcon iconSlug={slug} alt="" size={16} />
          ) : (
            <Information size={16} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
            <Badge variant="kit" size="sm">
              Starter Kit
            </Badge>
            <Badge
              variant={requirement.required ? "warning" : "muted"}
              size="sm"
            >
              {requirement.required ? "required" : "optional"}
            </Badge>
          </div>
          {requirement.note && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {requirement.note}
            </p>
          )}
        </div>

        {granted.length > 0 ? (
          <Badge
            variant="muted"
            className="h-8 shrink-0 gap-1.5 px-3 text-sm text-foreground"
            data-testid={`starter-kit-connected-${requirement.accepts.join("-")}`}
          >
            <Checkmark size={16} className="text-success" />
            Connected
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => onConnect(requirement.accepts)}
            data-testid={`starter-kit-connect-${requirement.accepts.join("-")}`}
          >
            Connect
          </Button>
        )}
      </div>

      {granted.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {granted.map((connection) => (
            <li key={connection.id}>
              <ConnectionRowCard
                connection={connection}
                template={templateById.get(connection.templateId)}
                maintenance={maintenance(connection)}
                onRemove={() => onRevoke(connection.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
