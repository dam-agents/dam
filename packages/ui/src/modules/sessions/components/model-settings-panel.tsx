import { Checkmark, ChevronDown } from "@carbon/icons-react";
import { modelConstraintsFor } from "agent-runtime-api";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHeader } from "@/components/ui/list-section";

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

export interface Choice {
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
  const constraints = modelConstraintsFor(catalog, shownModel);

  const change = (field: string, value: string | null) => {
    draft.set(field, value);
    if (field !== "model") return;
    const allowed = modelConstraintsFor(catalog, value) ?? {};
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
    const cur = valueOf(group.id) ?? group.default ?? null;
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
        clearable={group.id === "model"}
        disabled={disabled}
        onSelect={(id) => change(group.id, id)}
      />
    );
  });

  const note = (
    <p className="pt-3 text-2xs leading-snug text-muted-foreground">
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
      <SectionHeader label="Model settings">{headerAction}</SectionHeader>
      <Callout>
        {fromSnapshot && capturedAt && <SnapshotNote capturedAt={capturedAt} />}
        {groups}
        {note}
      </Callout>
    </section>
  );
}

const CLEARED_LABEL = "Agent default";
const CLEARED_DESCRIPTION = "The model the agent's harness starts on";

function OptionGroup({
  title,
  choices,
  value,
  clearable,
  disabled = false,
  onSelect,
}: {
  title: string;
  choices: Choice[];
  value: string | null;
  clearable: boolean;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
}) {
  if (disabled) {
    const selected =
      value === null ? null : choices.find((c) => c.id === value);
    return (
      <OptionField title={title}>
        <ReadOnlyOptionFace label={selected?.name ?? value ?? CLEARED_LABEL} />
      </OptionField>
    );
  }
  return (
    <OptionField title={title}>
      <OptionPicker
        title={title}
        choices={choices}
        value={value}
        clearable={clearable}
        onSelect={onSelect}
      />
    </OptionField>
  );
}

export function OptionPicker({
  title,
  choices,
  value,
  clearable = false,
  placeholder = CLEARED_LABEL,
  clearedLabel = CLEARED_LABEL,
  clearedDescription = CLEARED_DESCRIPTION,
  onSelect,
}: {
  title: string;
  choices: Choice[];
  value: string | null;
  clearable?: boolean;
  placeholder?: string;
  clearedLabel?: string;
  clearedDescription?: string;
  onSelect: (id: string | null) => void;
}) {
  const selected = value === null ? null : choices.find((c) => c.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={title}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-4 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">
            {selected?.name ?? value ?? placeholder}
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {clearable && (
          <OptionItem
            label={clearedLabel}
            description={clearedDescription}
            active={value === null}
            onSelect={() => onSelect(null)}
          />
        )}
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
        <span className="pl-[18px] font-mono text-2xs text-muted-foreground">
          {detail}
        </span>
      )}
      {description && (
        <span className="pl-[18px] text-2xs text-muted-foreground">
          {description}
        </span>
      )}
    </DropdownMenuItem>
  );
}
