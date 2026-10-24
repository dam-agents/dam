import { ChevronDown } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { labelVariants } from "@/components/ui/label";
import { PopoverClose } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { type ModelGroup, sameModel } from "../lib/catalog-groups.js";
import {
  familyModelGroups,
  type FamilySection,
  type MenuEntry,
  type ModelOption,
  type OtherSection,
} from "../lib/model-families.js";
import { AwakeModelsGate } from "./awake-models-gate.js";

interface Props {
  agentId: string;
  groups: readonly ModelGroup[];
  current: string | null;
  loading: boolean;
  waiting?: boolean;
  failed: boolean;
  onRetry: () => void;
  onChoose: (model: string, group: ModelGroup) => void;
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
 * UNIT_BOUNDARY_DESCRIPTION: every provider the harness accepts, grouped by
 * model family and size with older and variant models behind More, the
 * providers of a model picked on the entry itself, and models of no known
 * family under Other.
 */
export function SessionModelList({ agentId, ...listed }: Props) {
  return (
    <AwakeModelsGate agentId={agentId} className="px-1 py-1">
      <ListedModels {...listed} />
    </AwakeModelsGate>
  );
}

function ListedModels({
  groups,
  current,
  loading,
  waiting = false,
  failed,
  onRetry,
  onChoose,
  harnessName,
}: Omit<Props, "agentId">) {
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
  const { families, other } = familyModelGroups(groups);
  return (
    <>
      {families.map((section) => (
        <FamilyModelSection
          key={section.family.token}
          section={section}
          current={current}
          onChoose={onChoose}
        />
      ))}
      <OtherModelSection
        other={other}
        current={current}
        loading={loading}
        waiting={waiting}
        harnessName={harnessName}
        onRetry={onRetry}
        onChoose={onChoose}
      />
    </>
  );
}

function FamilyModelSection({
  section,
  current,
  onChoose,
}: {
  section: FamilySection;
  current: string | null;
  onChoose: (model: string, group: ModelGroup) => void;
}) {
  const [expanded, setExpanded] = useState(() =>
    section.more.some((entry) =>
      entry.options.some((option) => sameModel(current, option.model.name)),
    ),
  );
  return (
    <section aria-label={section.family.name} className="flex flex-col px-1">
      <div className="flex h-6 items-center">
        <h3 className={cn("truncate", labelVariants())}>
          {section.family.name}
        </h3>
      </div>
      <ul className="flex flex-col">
        {(expanded ? section.expanded : section.newest).map((entry) => (
          <ModelRow
            key={entry.key}
            entry={entry}
            current={current}
            onChoose={onChoose}
          />
        ))}
        {section.more.length > 0 && (
          <li>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={cn("transition-transform", expanded && "rotate-180")}
              />
              {expanded ? "Less" : "More"}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function OtherModelSection({
  other,
  current,
  loading,
  waiting,
  harnessName,
  onRetry,
  onChoose,
}: {
  other: OtherSection;
  current: string | null;
  loading: boolean;
  waiting: boolean;
  harnessName: string | undefined;
  onRetry: () => void;
  onChoose: (model: string, group: ModelGroup) => void;
}) {
  if (other.models.length === 0 && other.unlisted.length === 0) return null;
  return (
    <section aria-label="Other" className="flex flex-col px-1">
      <div className="flex h-6 items-center">
        <h3 className={cn("truncate", labelVariants())}>Other</h3>
      </div>
      <ul className="flex flex-col">
        {other.models.map((entry) => (
          <ModelRow
            key={entry.key}
            entry={entry}
            current={current}
            onChoose={onChoose}
          />
        ))}
        {other.unlisted.map((group) => (
          <li
            key={group.connectionId}
            className="px-2 py-1 text-muted-foreground"
          >
            {group.displayName}:{" "}
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
        ))}
      </ul>
    </section>
  );
}

function ModelRow({
  entry,
  current,
  onChoose,
}: {
  entry: MenuEntry;
  current: string | null;
  onChoose: (model: string, group: ModelGroup) => void;
}) {
  const isCurrent = entry.options.some((o) => sameModel(current, o.model.name));
  const option =
    entry.options.find((o) => sameModel(current, o.model.name)) ??
    entry.options[0]!;
  return (
    <li className="flex items-center gap-1">
      <PopoverClose asChild>
        <button
          type="button"
          aria-current={isCurrent ? "true" : undefined}
          title={option.model.name}
          onClick={() => onChoose(option.model.name, option.group)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground",
            isCurrent && "font-medium text-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        </button>
      </PopoverClose>
      {entry.options.length > 1 && (
        <ProviderChoice
          label={entry.label}
          options={entry.options}
          selected={option}
          onPick={(next) => onChoose(next.model.name, next.group)}
        />
      )}
    </li>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one model, several providers: the entry keeps
 * the provider's model name for the router, so picking a provider here is
 * picking its model, exactly as its own row would.
 */
function ProviderChoice({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  options: readonly ModelOption[];
  selected: ModelOption;
  onPick: (option: ModelOption) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={selected.group.displayName}
          aria-label={`Provider for ${label}: ${selected.group.displayName}`}
          className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {selected.group.displayName}
          <ChevronDown size={12} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={selected.group.connectionId}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.group.connectionId}
              value={option.group.connectionId}
              onSelect={() => onPick(option)}
            >
              {option.group.displayName}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
