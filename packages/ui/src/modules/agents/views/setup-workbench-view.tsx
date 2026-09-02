import { Add, Box, Close, Launch, LogoGithub } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, cardSelectionVariants } from "@/components/ui/card";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Inset } from "@/components/ui/inset";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import type { Pack, PackSlot } from "../../packs/data/packs.js";
import { PACKS } from "../../packs/data/packs.js";
import { AddSkillSourceModal } from "../../sandboxes/components/skills/add-skill-source-modal.js";
import type { ScheduleDraft } from "../../sandboxes/hooks/use-setup-form.js";
import { ScheduleSetupSection } from "../../schedules/components/schedule-setup-section.js";

const SAMPLE_PACK = PACKS[0]!;

export function SetupWorkbenchView() {
  const [presetOn, setPresetOn] = useState(true);
  const [selectedPack, setSelectedPack] = useState<Pack>(SAMPLE_PACK);

  return (
    <div>
      <PageHeader
        title="Setup Workbench"
        description="Iterate on agent setup section interactions — normal mode vs preset mode."
      />

      <div className="mb-8 flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">
          Mode:
        </span>
        <button
          type="button"
          onClick={() => setPresetOn(false)}
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium transition-colors",
            !presetOn
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          No preset
        </button>
        <button
          type="button"
          onClick={() => setPresetOn(true)}
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium transition-colors",
            presetOn
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          With preset
        </button>

        {presetOn && (
          <select
            value={selectedPack.id}
            onChange={(e) => {
              const p = PACKS.find((pk) => pk.id === e.target.value);
              if (p) setSelectedPack(p);
            }}
            className="ml-3 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
          >
            {PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mx-auto max-w-[640px]">
        <PresetBarSection pack={presetOn ? selectedPack : null} />
        <hr className="my-6 border-border" />
        <ScheduleWorkbench pack={presetOn ? selectedPack : null} />
        <hr className="my-6 border-border" />
        <ConnectionsWorkbench pack={presetOn ? selectedPack : null} />
        <hr className="my-6 border-border" />
        <SkillsWorkbench pack={presetOn ? selectedPack : null} />
        <hr className="my-6 border-border" />
        <ChannelsWorkbench pack={presetOn ? selectedPack : null} />
      </div>
    </div>
  );
}

function PresetBarSection({ pack }: { pack: Pack | null }) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Preset Bar
      </h2>
      <Inset>
        {pack ? (
          <PresetBar pack={pack} />
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-preset-border bg-preset-light/60 px-4 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-preset/15">
              <Box size={16} className="text-preset" />
            </div>
            <p className="flex-1 text-sm text-foreground/70">
              Want a head start? Pick a preset to pre-fill harness, skills, and
              connections.
            </p>
            <Button variant="outline" size="sm">
              Browse presets
            </Button>
          </div>
        )}
      </Inset>
    </section>
  );
}

function PresetBar({ pack }: { pack: Pack }) {
  const Icon = pack.icon;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-preset-border bg-preset-border/40 px-4 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-preset/15">
        <Icon size={16} className="text-preset" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-preset">{pack.name}</p>
        <p className="text-sm text-foreground/70">
          Preset applied to this agent
        </p>
      </div>
      <Button variant="outline" size="sm">
        Change
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:bg-preset-border hover:text-foreground"
      >
        <Close size={16} />
      </Button>
    </div>
  );
}

function ScheduleWorkbench({ pack }: { pack: Pack | null }) {
  const scheduleSlots = useMemo(() => {
    if (!pack) return [];
    return [...pack.included, ...pack.required].filter(
      (s) => s.kind === "schedule",
    );
  }, [pack]);

  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);

  const presetDrafts = useMemo<ScheduleDraft[]>(
    () =>
      scheduleSlots.map((s) => ({
        name: s.label,
        task: s.description,
        kind: "daily" as const,
        interval: "1",
        time: "09:00",
        days: [1],
        customRRule: "",
        quietHours: [],
        timezone: "America/New_York",
        sessionMode: "fresh" as const,
        enabled: true,
      })),
    [scheduleSlots],
  );

  const allDrafts = useMemo(
    () => [...presetDrafts, ...drafts],
    [presetDrafts, drafts],
  );

  const presetIndices = useMemo(() => {
    if (presetDrafts.length === 0) return undefined;
    return new Set(Array.from({ length: presetDrafts.length }, (_, i) => i));
  }, [presetDrafts]);

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Schedules
      </h2>
      <ScheduleSetupSection
        drafts={allDrafts}
        onDraftsChange={(next) => setDrafts(next.slice(presetDrafts.length))}
        presetIndices={presetIndices}
      />
    </section>
  );
}

function ConnectionsWorkbench({ pack }: { pack: Pack | null }) {
  const connectionSlots = useMemo(() => {
    if (!pack) return [];
    return [...pack.included, ...pack.required].filter(
      (s) => s.kind === "connection",
    );
  }, [pack]);

  const kbSlots = useMemo(() => {
    if (!pack) return [];
    return [...pack.included, ...pack.required].filter(
      (s) => s.kind === "knowledge-base",
    );
  }, [pack]);

  const allSlots = useMemo(
    () => [...connectionSlots, ...kbSlots],
    [connectionSlots, kbSlots],
  );

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = useMemo(
    () => allSlots.filter((s) => !dismissed.has(`${s.kind}-${s.label}`)),
    [allSlots, dismissed],
  );

  const [connected, setConnected] = useState<Set<string>>(new Set());

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Connections
      </h2>

      {visible.length === 0 && connected.size === 0 ? (
        <>
          <SectionLabel spaced>
            Connections{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </SectionLabel>
          <EmptyStateCard
            message="You have not added any Connections to this Agent yet"
            actionLabel="Add Connection"
            onAction={() => {}}
            actionTestId="open-connection-catalog"
          />
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>
              Connections{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </SectionLabel>
            <Button variant="outline" size="sm">
              <Add size={16} />
              Add Connection
            </Button>
          </div>
          <Inset className="flex flex-col gap-3">
            {connected.size > 0 &&
              [...connected].map((label) => (
                <Card key={label} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <ConnectionIcon iconSlug="github" alt="" size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {label}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Connected
                    </p>
                  </div>
                </Card>
              ))}
            {visible.map((slot) => (
              <RecommendedConnectionCard
                key={`${slot.kind}-${slot.label}`}
                slot={slot}
                onConnect={() => {
                  setConnected((prev) => new Set([...prev, slot.label]));
                  setDismissed(
                    (prev) =>
                      new Set([...prev, `${slot.kind}-${slot.label}`]),
                  );
                }}
                onDismiss={() =>
                  setDismissed(
                    (prev) =>
                      new Set([...prev, `${slot.kind}-${slot.label}`]),
                  )
                }
              />
            ))}
          </Inset>
        </>
      )}
    </section>
  );
}

function RecommendedConnectionCard({
  slot,
  onConnect,
  onDismiss,
}: {
  slot: PackSlot;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  const isKb = slot.kind === "knowledge-base";
  const iconSlug =
    slot.connectionTemplateId === "conn-tpl-github" ? "github" : undefined;

  return (
    <Card className="flex items-center gap-4 border-preset-border/50 bg-preset-light/60 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-preset/8">
        <ConnectionIcon iconSlug={iconSlug} alt={slot.label} size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{slot.label}</p>
          <Badge variant="preset">Preset</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {slot.description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isKb ? (
          <span className="text-sm text-muted-foreground/60">Coming soon</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onConnect}
          >
            <Add size={16} />
            Connect
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-preset-border hover:text-foreground"
          onClick={onDismiss}
          aria-label={`Remove ${slot.label}`}
        >
          <Close size={16} />
        </Button>
      </div>
    </Card>
  );
}

function SkillsWorkbench({ pack }: { pack: Pack | null }) {
  const skillSlots = useMemo(() => {
    if (!pack) return [];
    return [...pack.included, ...pack.required].filter(
      (s) => s.kind === "skill",
    );
  }, [pack]);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = useMemo(
    () => skillSlots.filter((s) => !dismissed.has(s.label)),
    [skillSlots, dismissed],
  );

  const [addedSources, setAddedSources] = useState<SkillSource[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const hasContent = visible.length > 0 || addedSources.length > 0;

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Skills
      </h2>

      {!hasContent ? (
        <div className="mb-8">
          <SectionLabel spaced>
            Skills{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </SectionLabel>
          <Callout inset className="bg-card">
            <div className="flex flex-col items-center gap-4 py-6">
              <p className="text-center text-sm text-foreground/80">
                Add skill sources to extend this agent's capabilities
              </p>
              <Button variant="outline" onClick={() => setModalOpen(true)}>
                <Add size={16} />
                Add skill source
              </Button>
            </div>
          </Callout>
        </div>
      ) : (
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Skills</SectionLabel>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(true)}
            >
              <Add size={16} />
              Add skill source
            </Button>
          </div>
          <Inset className="flex flex-col gap-3">
            {visible.map((slot) => (
              <Card
                key={slot.label}
                className="flex items-center gap-4 border-preset-border/50 bg-preset-light/60 p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-preset/8">
                  <Launch size={16} className="text-preset" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {slot.label}
                    </p>
                    <Badge variant="preset">Preset</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {slot.description}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:bg-preset-border hover:text-foreground"
                  onClick={() =>
                    setDismissed((prev) => new Set([...prev, slot.label]))
                  }
                  aria-label={`Remove ${slot.label}`}
                >
                  <Close size={16} />
                </Button>
              </Card>
            ))}
            {addedSources.map((source) => (
              <Card key={source.id} className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <LogoGithub size={16} className="text-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {source.name}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {source.gitUrl}
                    {source.path ? `/${source.path}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setAddedSources((prev) =>
                      prev.filter((s) => s.id !== source.id),
                    )
                  }
                  aria-label={`Remove ${source.name}`}
                >
                  <Close size={16} />
                </Button>
              </Card>
            ))}
          </Inset>
        </div>
      )}

      {modalOpen && (
        <AddSkillSourceModal
          onClose={() => setModalOpen(false)}
          onCreate={async (input) => {
            const source: SkillSource = {
              id: `src-${Date.now()}`,
              name: input.name,
              gitUrl: input.gitUrl,
              path: input.path,
            };
            setAddedSources((prev) => [...prev, source]);
            setModalOpen(false);
            return source;
          }}
          onCreateSkills={async () => ({ ok: true as const })}
        />
      )}
    </section>
  );
}

function ChannelsWorkbench({ pack }: { pack: Pack | null }) {
  const channelSlots = useMemo(() => {
    if (!pack) return [];
    return [...pack.included, ...pack.required].filter(
      (s) => s.kind === "channel",
    );
  }, [pack]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const presetChannelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slot of channelSlots) {
      const text =
        `${slot.label} ${slot.description} ${slot.demoValue ?? ""}`.toLowerCase();
      if (text.includes("slack") || text.includes("#")) ids.add("slack");
      if (text.includes("telegram")) ids.add("telegram");
    }
    return ids;
  }, [channelSlots]);

  const channels = [
    {
      id: "slack",
      label: "In a Slack channel",
      description:
        "Your team can interact with the agent in a Slack channel or their DMs.",
      iconSlug: "slack",
    },
    {
      id: "telegram",
      label: "In a Telegram chat",
      description:
        "Your team can interact with the agent in a Telegram group or DM.",
      iconSlug: "telegram",
    },
  ];

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Channels
      </h2>

      <SectionLabel spaced>
        <span className="flex items-center gap-2">
          Channels
          <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
      </SectionLabel>

      <Inset className="flex flex-col gap-3">
        {channels.map((ch) => {
          const isFromPreset = presetChannelIds.has(ch.id);
          const isSelected =
            selected.has(ch.id) || (pack !== null && isFromPreset);

          return (
            <ChannelCard
              key={ch.id}
              channel={ch}
              isSelected={isSelected}
              isFromPreset={isFromPreset && pack !== null}
              onToggle={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(ch.id)) next.delete(ch.id);
                  else next.add(ch.id);
                  return next;
                })
              }
            />
          );
        })}
      </Inset>
    </section>
  );
}

function ChannelCard({
  channel,
  isSelected,
  isFromPreset,
  onToggle,
}: {
  channel: { id: string; label: string; description: string; iconSlug: string };
  isSelected: boolean;
  isFromPreset: boolean;
  onToggle: () => void;
}) {
  const isPresetSelected = isSelected && isFromPreset;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        isPresetSelected
          ? cn(
              "flex items-center gap-3 rounded-lg border border-preset-border/50 bg-preset-light/60 px-4 py-3 text-left transition-colors",
            )
          : cardSelectionVariants({
              selected: isSelected,
              className: "flex items-center gap-3 px-4 py-3 text-left",
            })
      }
    >
      <span className="shrink-0">
        <ConnectionIcon iconSlug={channel.iconSlug} alt="" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {channel.label}
          </span>
          {isFromPreset && <Badge variant="preset">Preset</Badge>}
        </span>
        <span className="block text-sm text-muted-foreground">
          {channel.description}
        </span>
      </span>
      <span className="ml-auto shrink-0">
        <span
          className={`flex size-4 items-center justify-center rounded-full border ${
            isPresetSelected
              ? "border-preset"
              : isSelected
                ? "border-foreground"
                : "border-muted-foreground/50"
          }`}
        >
          {isSelected && (
            <span
              className={`size-2 rounded-full ${isPresetSelected ? "bg-preset" : "bg-foreground"}`}
            />
          )}
        </span>
      </span>
    </button>
  );
}
