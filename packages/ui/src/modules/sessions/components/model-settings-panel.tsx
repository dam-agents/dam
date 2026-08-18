import { Checkmark, ChevronDown } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";

import {
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
} from "../../agents/api/harness-config.js";
import {
  SnapshotNote,
  StaleModelCallout,
  unavailableModel,
} from "./model-settings-snapshot.js";
import { OptionField, ReadOnlyOptionFace } from "./option-field.js";

interface Choice {
  id: string;
  name: string;
  description?: string | null;
}

export function ModelSettingsPanel({
  agentId,
  disabled = false,
  headerAction,
  draft,
}: {
  agentId: string | null;
  disabled?: boolean;
  headerAction?: ReactNode;
  draft: {
    valueOf: (field: string) => string | null;
    set: (field: string, value: string | null) => void;
  };
}) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const {
    values: current,
    origin,
    capturedAt,
    modelsPaired,
  } = useResolvedHarnessConfig(agentId);
  const catalog = status?.catalog ?? null;
  if (!agentId || !catalog || catalog.options.length === 0) return null;

  const valueOf = (field: string): string | null => draft.valueOf(field);

  const shownModel = valueOf("model");
  const constraints =
    (shownModel && catalog.modelConstraints?.[shownModel]) || undefined;

  const change = (field: string, value: string | null) => {
    draft.set(field, value);
    if (field !== "model") return;
    const allowed = (value && catalog.modelConstraints?.[value]) || {};
    for (const group of catalog.options) {
      if (group.id === "model") continue;
      const list = allowed[group.id];
      const staged = draft.valueOf(group.id);
      if (list && staged && !list.includes(staged)) draft.set(group.id, null);
    }
  };

  const groups = catalog.options.map((group) => {
    const source =
      group.id === "model" && current?.availableModels?.length
        ? current.availableModels
        : group.choices;
    const allowed = group.id === "model" ? undefined : constraints?.[group.id];
    const choices: Choice[] = source
      .filter((c) => !allowed || allowed.includes(c.value))
      .map((c) => ({
        id: c.value,
        name: c.name,
        description: c.description,
      }));
    const cur = valueOf(group.id);
    if (cur && !choices.some((c) => c.id === cur)) {
      choices.push({
        id: cur,
        name: cur,
        description: source.some((c) => c.value === cur)
          ? "Not available for the current model"
          : "Set directly in the config file",
      });
    }
    if (choices.length === 0) return null;
    return (
      <OptionGroup
        key={group.id}
        title={group.name}
        choices={choices}
        value={cur}
        disabled={disabled}
        onSelect={(id) => change(group.id, id)}
      />
    );
  });

  const note = (
    <p className="pt-3 text-[11px] leading-snug text-muted-foreground">
      Applies to new sessions. A session that's already running keeps the
      settings it started with — start a new session to use these.
    </p>
  );

  const fromSnapshot = origin === "snapshot";
  const staleModel =
    fromSnapshot && current && modelsPaired ? unavailableModel(current) : null;
  return (
    <section className="mb-8">
      {staleModel && <StaleModelCallout model={staleModel} />}
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        <SectionLabel>Model settings</SectionLabel>
        {headerAction}
      </div>
      <Callout inset>
        {fromSnapshot && capturedAt && <SnapshotNote capturedAt={capturedAt} />}
        {groups}
        {note}
      </Callout>
    </section>
  );
}

const CLEARED_LABEL = "Default";
const CLEARED_DESCRIPTION = "Determined by harness settings";

function OptionGroup({
  title,
  choices,
  value,
  disabled = false,
  onSelect,
}: {
  title: string;
  choices: Choice[];
  value: string | null;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
}) {
  const selected = value === null ? null : choices.find((c) => c.id === value);
  if (disabled) {
    return (
      <OptionField title={title}>
        <ReadOnlyOptionFace label={selected?.name ?? CLEARED_LABEL} />
      </OptionField>
    );
  }
  return (
    <OptionField title={title}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={title}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-4 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{selected?.name ?? CLEARED_LABEL}</span>
            <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          <OptionItem
            label={CLEARED_LABEL}
            description={CLEARED_DESCRIPTION}
            active={value === null}
            onSelect={() => onSelect(null)}
          />
          {choices.map((c) => (
            <OptionItem
              key={c.id}
              label={c.name}
              detail={c.name === c.id ? undefined : c.id}
              description={c.description}
              active={c.id === value}
              onSelect={() => onSelect(c.id)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </OptionField>
  );
}

function OptionItem({
  label,
  detail,
  description,
  active,
  onSelect,
}: {
  label: string;
  detail?: string;
  description?: string | null;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="h-auto flex-col items-start gap-0.5 py-2"
    >
      <span className="flex items-center gap-1.5 font-medium">
        {active && <Checkmark size={12} className="shrink-0" />}
        <span className={active ? "" : "pl-[18px]"}>{label}</span>
      </span>
      {detail && (
        <span className="pl-[18px] font-mono text-[11px] text-muted-foreground">
          {detail}
        </span>
      )}
      {description && (
        <span className="pl-[18px] text-[11px] text-muted-foreground">
          {description}
        </span>
      )}
    </DropdownMenuItem>
  );
}
