import { Unlink } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { labelVariants } from "@/components/ui/label";
import { PopoverClose } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  contextLabel,
  type ModelGroup,
  modelLabel,
  sameModel,
} from "../lib/catalog-groups.js";

interface Props {
  groups: readonly ModelGroup[];
  current: string | null;
  loading: boolean;
  waiting?: boolean;
  failed: boolean;
  operable: boolean;
  starting?: boolean;
  onRetry: () => void;
  onChoose: (model: string, group: ModelGroup) => void;
  onDisconnect?: (group: ModelGroup) => void;
  disconnecting?: boolean;
  harnessName?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a provider never listed while the catalog is
 * still being polled is waiting for its first listing, which follows a grant
 * by a gateway restart, not failing.
 */
const firstListing = (group: ModelGroup, waiting: boolean) =>
  waiting && group.status === "unavailable" && group.listedAt === null;

/**
 * UNIT_BOUNDARY_DESCRIPTION: every provider the harness accepts, with its
 * listing state said in place rather than a provider silently missing.
 */
export function SessionModelList({
  groups,
  current,
  loading,
  waiting = false,
  failed,
  operable,
  starting = false,
  onRetry,
  onChoose,
  onDisconnect,
  disconnecting = false,
  harnessName,
}: Props) {
  if (!operable)
    return (
      <p className="px-1 py-1 text-muted-foreground">
        {starting ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner size={12} className="text-muted-foreground" />
            Loading models…
          </span>
        ) : (
          "Start the agent to list models."
        )}
      </p>
    );
  if (groups.length === 0)
    return (
      <p className="px-1 py-1 text-muted-foreground">
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner size={12} className="text-muted-foreground" />
            Loading models…
          </span>
        ) : failed ? (
          <>
            Couldn't load the models.
            <Button
              variant="link"
              size="inline"
              className="ml-1"
              onClick={onRetry}
            >
              Retry
            </Button>
          </>
        ) : (
          "No models available."
        )}
      </p>
    );
  return (
    <>
      {groups.map((group) => (
        <section
          key={group.connectionId}
          aria-label={group.displayName}
          className="flex flex-col px-1"
        >
          <div className="group/provider flex h-6 items-center justify-between gap-2">
            <h3 className={cn("truncate", labelVariants())}>
              {group.displayName}
            </h3>
            {onDisconnect && (
              <Tooltip content="Disconnect">
                <PopoverClose asChild>
                  <button
                    type="button"
                    disabled={disconnecting}
                    aria-label={`Disconnect ${group.displayName}`}
                    onClick={() => onDisconnect(group)}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/provider:opacity-100 disabled:opacity-50"
                  >
                    <Unlink size={14} />
                  </button>
                </PopoverClose>
              </Tooltip>
            )}
          </div>
          <ul className="flex flex-col">
            {group.models.map((m) => (
              <li key={m.name}>
                <PopoverClose asChild>
                  <button
                    type="button"
                    aria-current={
                      sameModel(current, m.name) ? "true" : undefined
                    }
                    title={m.name}
                    onClick={() => onChoose(m.name, group)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground",
                      sameModel(current, m.name) &&
                        "font-medium text-foreground",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {modelLabel(m)}
                    </span>
                    {contextLabel(m) && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {contextLabel(m)}
                      </span>
                    )}
                  </button>
                </PopoverClose>
              </li>
            ))}
            {group.models.length === 0 && (
              <li className="px-2 py-1 text-muted-foreground">
                {group.status === "unsupported" ? (
                  `Not compatible with ${harnessName ?? "this harness"}.`
                ) : loading || firstListing(group, waiting) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner size={12} className="text-muted-foreground" />
                    Loading models…
                  </span>
                ) : group.status === "unavailable" ? (
                  "Couldn't list this provider's models."
                ) : (
                  "No models listed."
                )}
                {group.status === "unavailable" &&
                  !firstListing(group, waiting) && (
                    <Button
                      variant="link"
                      size="inline"
                      className="ml-1"
                      onClick={onRetry}
                    >
                      Retry
                    </Button>
                  )}
              </li>
            )}
          </ul>
        </section>
      ))}
    </>
  );
}
