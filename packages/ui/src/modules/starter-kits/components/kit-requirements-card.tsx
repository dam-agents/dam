import { Close, Information } from "@carbon/icons-react";
import type {
  ConnectionTemplateView,
  ConnectionView,
  StarterKitView,
} from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { GithubAppInstallButton } from "../../connections/components/github-app-install-hint.js";
import { GithubStepsCallout } from "../../connections/forms/github-steps-callout.js";
import {
  accepts,
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
  granted: readonly ConnectionView[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  templates: readonly ConnectionTemplateView[];
  onUse: (connectionId: string) => void;
  onRevoke: (connectionId: string) => void;
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
  granted,
  templateById,
  templates,
  onUse,
  onRevoke,
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
          const filling = granted.filter((c) =>
            accepts(requirement, c, templateById),
          );
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
                {isProviderRequirement(requirement) && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Pick one under Provider above.
                  </p>
                )}
              </div>

              {!satisfied && !isProviderRequirement(requirement) && (
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
              )}
              {filling.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {filling.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-lg border border-kit-line bg-card"
                    >
                      <GithubStepsCallout
                        templateId={c.templateId}
                        className="mx-3 mt-3"
                      />
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <ConnectionIcon
                          iconSlug={templateById.get(c.templateId)?.iconSlug}
                          alt=""
                          size={16}
                          className="shrink-0 text-foreground/80"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {c.name}
                        </span>
                        <Badge variant="muted" size="sm">
                          {templateById.get(c.templateId)?.name ?? c.templateId}
                        </Badge>
                        <GithubAppInstallButton connection={c} />
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${c.name}`}
                          onClick={() => onRevoke(c.id)}
                        >
                          <Close size={16} />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
