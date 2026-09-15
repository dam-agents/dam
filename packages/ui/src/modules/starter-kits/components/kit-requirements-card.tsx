import { CheckmarkFilled, Information } from "@carbon/icons-react";
import type { ConnectionTemplateView, StarterKitView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import {
  type ConnectTarget,
  connectTargets,
  describeAccepts,
  type GrantedConnection,
  isProviderRequirement,
  ownedMatches,
  type RequirementStatus,
} from "../lib/setup.js";

interface Props {
  kit: StarterKitView;
  statuses: readonly RequirementStatus[];
  owned: readonly GrantedConnection[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  templates: readonly ConnectionTemplateView[];
  onUse: (connectionId: string) => void;
  onConnect: (target: ConnectTarget) => void;
}

function iconSlugFor(
  accepts: readonly string[],
  templates: readonly ConnectionTemplateView[],
): string | undefined {
  return templates.find(
    (t) =>
      (accepts.includes(t.id) || (t.family && accepts.includes(t.family.id))) &&
      t.iconSlug,
  )?.iconSlug;
}

export function KitRequirementsCard({
  kit,
  statuses,
  owned,
  templateById,
  templates,
  onUse,
  onConnect,
}: Props) {
  const why = kit.connections.find((c) => c.required && c.note)?.note;

  return (
    <div className="overflow-hidden rounded-lg border border-kit-line bg-kit-surface">
      {why && (
        <div className="px-4 py-3">
          <div className="flex items-start gap-2.5 rounded-lg bg-kit-tint px-3 py-2.5">
            <Information size={16} className="mt-0.5 shrink-0 text-kit" />
            <p className="text-sm text-foreground/80">
              {kit.name} needs {why}
            </p>
          </div>
        </div>
      )}

      <ul>
        {statuses.map(({ requirement, satisfied }) => {
          const slug = iconSlugFor(requirement.accepts, templates);
          return (
            <li
              key={requirement.accepts.join("|")}
              className="flex items-center gap-4 border-t border-kit-rule px-4 py-4 first:border-t-0"
              data-testid={`starter-kit-requirement-${requirement.accepts.join("-")}`}
            >
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
                    {describeAccepts(requirement.accepts, templateById)}
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
                {!satisfied && isProviderRequirement(requirement) && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Pick one under Provider above.
                  </p>
                )}
              </div>

              {satisfied ? (
                <span className="flex shrink-0 items-center gap-1.5 text-sm text-success">
                  <CheckmarkFilled size={16} />
                  {isProviderRequirement(requirement)
                    ? "Connected"
                    : "Connected below"}
                </span>
              ) : (
                !isProviderRequirement(requirement) && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {ownedMatches(requirement, owned, templateById).map((c) => (
                      <Button
                        key={`use-${c.id}`}
                        size="sm"
                        variant="secondary"
                        onClick={() => onUse(c.id)}
                        data-testid={`starter-kit-use-${c.id}`}
                      >
                        Use {c.name ?? c.id}
                      </Button>
                    ))}
                    {connectTargets(requirement, templateById).map((t) => (
                      <Button
                        key={t.key}
                        size="sm"
                        variant="outline"
                        onClick={() => onConnect(t)}
                        data-testid={`starter-kit-connect-${t.key}`}
                      >
                        Connect {t.label}
                      </Button>
                    ))}
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
