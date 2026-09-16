import { Information, OverflowMenuVertical } from "@carbon/icons-react";
import type {
  ConnectionTemplateView,
  ConnectionView,
  StarterKitConnectionRequirement,
} from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { GithubAppInstallButton } from "../../connections/components/github-app-install-hint.js";
import { GithubStepsCallout } from "../../connections/forms/github-steps-callout.js";
import {
  type ConnectTarget,
  connectTargets,
  describeAccepts,
  type GrantedConnection,
  requirementChoice,
} from "../lib/setup.js";

interface Props {
  requirement: StarterKitConnectionRequirement;
  owned: readonly GrantedConnection[];
  granted: readonly ConnectionView[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  templates: readonly ConnectionTemplateView[];
  onUse: (connectionId: string) => void;
  onRevoke: (connectionId: string) => void;
  onConnect: (target: ConnectTarget) => void;
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

function nameOf(connection: { id: string; name?: string }): string {
  return connection.name ?? connection.id;
}

function ChosenConnection({
  connection,
  templateById,
  showTemplate,
}: {
  connection: ConnectionView;
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  showTemplate: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 rounded-md border border-kit-line bg-kit-tint py-1.5 pl-2.5 pr-1.5">
      <ConnectionIcon
        iconSlug={templateById.get(connection.templateId)?.iconSlug}
        alt=""
        size={16}
        className="shrink-0 text-foreground/80"
      />
      <span className="truncate text-sm text-foreground">
        {nameOf(connection)}
      </span>
      {showTemplate && (
        <Badge variant="muted" size="sm">
          {templateById.get(connection.templateId)?.name ??
            connection.templateId}
        </Badge>
      )}
      <GithubAppInstallButton connection={connection} />
    </span>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One row of a starter kit's connection
 * requirements. With nothing connected it offers the connect buttons; with one
 * candidate it uses that one; with several it asks which. Everything else the
 * requirement can reach sits in the overflow menu, so the row keeps one
 * primary action.
 */
export function KitRequirementRow({
  requirement,
  owned,
  granted,
  templateById,
  templates,
  onUse,
  onRevoke,
  onConnect,
}: Props) {
  const slug = iconSlugFor(requirement.accepts, templates);
  const title = describeAccepts(requirement.accepts, templateById);
  const { mode, chosen, candidates, switchTo } = requirementChoice(
    requirement,
    owned,
    granted,
    templateById,
  );
  const targets = connectTargets(requirement, templateById);
  const showMenu = mode !== "connect";

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

        <div className="flex shrink-0 items-center gap-2">
          {chosen.map((c) => (
            <ChosenConnection
              key={c.id}
              connection={c}
              templateById={templateById}
              showTemplate={targets.length > 1}
            />
          ))}

          {mode === "use" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onUse(candidates[0].id)}
              data-testid={`starter-kit-use-${candidates[0].id}`}
            >
              Use {nameOf(candidates[0])}
            </Button>
          )}

          {mode === "pick" && (
            <div className="w-[220px]">
              <Select
                size="sm"
                value=""
                aria-label={`Connection for ${title}`}
                data-testid={`starter-kit-pick-${requirement.accepts.join("-")}`}
                onChange={(e) => e.target.value && onUse(e.target.value)}
              >
                <option value="">Choose a connection…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nameOf(c)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {mode === "connect" &&
            targets.map((t) => (
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

          {showMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More options for ${title}`}
                  data-testid={`starter-kit-more-${requirement.accepts.join("-")}`}
                >
                  <OverflowMenuVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {switchTo.map((c) => (
                  <DropdownMenuItem
                    key={`use-${c.id}`}
                    onSelect={() => {
                      onRevoke(chosen[0].id);
                      onUse(c.id);
                    }}
                  >
                    Use {nameOf(c)} instead
                  </DropdownMenuItem>
                ))}
                {targets.map((t) => (
                  <DropdownMenuItem
                    key={`connect-${t.key}`}
                    onSelect={() => onConnect(t)}
                  >
                    Connect another {t.label}
                  </DropdownMenuItem>
                ))}
                {chosen.length > 0 && (
                  <>
                    <DropdownMenuSeparator className="-mx-1" />
                    {chosen.map((c) => (
                      <DropdownMenuItem
                        key={`remove-${c.id}`}
                        className="text-destructive"
                        onSelect={() => onRevoke(c.id)}
                      >
                        Remove {nameOf(c)}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {chosen.map((c) => (
        <GithubStepsCallout
          key={`steps-${c.id}`}
          templateId={c.templateId}
          className="mt-3"
        />
      ))}
    </li>
  );
}
