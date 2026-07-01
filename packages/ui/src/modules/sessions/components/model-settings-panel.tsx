import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { queryClient } from "../../../query-client.js";
import {
  harnessConfigCurrentKey,
  useApplyHarnessConfig,
  useHarnessConfigCurrent,
  useHarnessConfigSettled,
  useHarnessConfigStatus,
} from "../../agents/api/harness-config.js";
import { Section } from "./config-section.js";

interface Choice {
  id: string;
  name: string;
  description?: string | null;
}

// The agent's persistent model/mode/config default, one picker per option group.
// Each picker is a compact trigger that opens a menu showing every choice with
// its description. No optimistic update: the displayed value is the live read,
// with a "saving" hint until the change settles and the value is re-read in one
// step. Hidden when no catalog.
export function ModelSettingsPanel({ agentId }: { agentId: string | null }) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const { data: current } = useHarnessConfigCurrent(agentId);
  const apply = useApplyHarnessConfig();

  // `awaitingSettle` is set only after the apply is enqueued, so the settle poll
  // can't observe a stale "already settled" before our event bumps the outbox.
  const [saving, setSaving] = useState(false);
  const [awaitingSettle, setAwaitingSettle] = useState(false);
  const settled = useHarnessConfigSettled(agentId, awaitingSettle);
  const settledNow = settled.data?.settled === true;
  useEffect(() => {
    if (!awaitingSettle || !settledNow) return;
    let cancelled = false;
    void (async () => {
      if (agentId) {
        await queryClient.invalidateQueries({
          queryKey: harnessConfigCurrentKey(agentId),
        });
      }
      if (!cancelled) {
        setAwaitingSettle(false);
        setSaving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awaitingSettle, settledNow, agentId]);
  // Give up if it never settles (agent down / slow).
  useEffect(() => {
    if (!saving) return;
    const t = setTimeout(() => {
      setSaving(false);
      setAwaitingSettle(false);
    }, 15_000);
    return () => clearTimeout(t);
  }, [saving]);

  const catalog = status?.catalog ?? null;
  if (!agentId || !catalog || catalog.options.length === 0) return null;

  const valueOf = (field: string): string | null => {
    if (field === "model") return current?.model ?? null;
    if (field === "mode") return current?.mode ?? null;
    const v = current?.configOptions[field];
    return typeof v === "string" ? v : null;
  };

  const constraints =
    (current?.model && catalog.modelConstraints?.[current.model]) || undefined;

  const change = (field: string, value: string | null) => {
    setSaving(true);
    const input =
      field === "model"
        ? value
          ? { agentId, model: value }
          : { agentId, unset: ["model"] }
        : field === "mode"
          ? value
            ? { agentId, mode: value }
            : { agentId, unset: ["mode"] }
          : value
            ? { agentId, configOptions: { [field]: value } }
            : { agentId, unset: [field] };
    apply.mutate(input, {
      onSuccess: () => setAwaitingSettle(true),
      onError: () => {
        setSaving(false);
        setAwaitingSettle(false);
      },
    });
  };

  return (
    <Section title="Model" headerRight={saving ? <SavingHint /> : undefined}>
      {catalog.options.map((group) => {
        // Model group uses live-discovered models when available, else the static catalog.
        const source =
          group.id === "model" && current?.availableModels?.length
            ? current.availableModels
            : group.choices;
        // Gate non-model groups by the model's allowlist (absent = all; empty = hide).
        const allowed =
          group.id === "model" ? undefined : constraints?.[group.id];
        const choices: Choice[] = source
          .filter((c) => !allowed || allowed.includes(c.value))
          .map((c) => ({
            id: c.value,
            name: c.name,
            description: c.description,
          }));
        const cur = valueOf(group.id);
        // Surface a persisted value that isn't in the (gated) choice list so the
        // picker shows what's actually set — otherwise a controlled picker with no
        // matching option would read as "Not set". Covers both a hand-set value
        // (not in the catalog) and one gated out by the current model.
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
            onSelect={(id) => change(group.id, id)}
          />
        );
      })}
      <p className="px-4 py-2.5 text-[11px] leading-snug text-text-muted">
        Applies to new sessions. A session that's already running keeps the
        settings it started with — start a new session to use these.
      </p>
    </Section>
  );
}

function SavingHint() {
  return (
    <span className="flex items-center gap-1 normal-case tracking-normal font-normal text-text-muted">
      <Loader2 size={11} className="animate-spin" />
      Saving…
    </span>
  );
}

function OptionGroup({
  title,
  choices,
  value,
  onSelect,
}: {
  title: string;
  choices: Choice[];
  value: string | null;
  onSelect: (id: string | null) => void;
}) {
  const selected = value === null ? null : choices.find((c) => c.id === value);
  return (
    <div className="border-b border-border-light last:border-b-0 px-4 py-3">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted">
        {title}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={title}
            className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border-light bg-transparent px-3 text-[13px] text-text transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{selected?.name ?? "Not set"}</span>
            <ChevronDown size={14} className="shrink-0 text-text-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          <OptionItem
            label="Not set"
            description="Clears the key — the harness picks on its own"
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
    </div>
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
        {active && <Check size={12} className="shrink-0" />}
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
