import type { CarbonIconType } from "@carbon/icons-react";
import {
  Box,
  Chat,
  Code,
  ConnectionSignal,
  Launch,
  Notebook,
  PlayFilledAlt,
  Time,
} from "@carbon/icons-react";
import { rruleToText } from "api-server-api";

import { GithubIcon } from "@/components/brand-icons";
import { DialogFooter, DialogHeader, Modal } from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { CardIcon } from "@/modules/providers/components/card-icon";

import type { Pack, PackIngredientKind, PackSlot } from "../data/packs.js";
import { PackIngredientSummary } from "./pack-ingredient-summary.js";

const SETUP_GROUP_LABELS: Partial<Record<PackIngredientKind, string>> = {
  harness: "Harness",
  framework: "Framework",
  connection: "Connections",
  channel: "Channels",
  "knowledge-base": "Knowledge bases",
  "starter-repo": "Starter repos",
};

const SETUP_KIND_ORDER: PackIngredientKind[] = [
  "harness",
  "framework",
  "connection",
  "channel",
  "knowledge-base",
  "starter-repo",
];

interface Props {
  pack: Pack | null;
  onClose: () => void;
  onCreateFromPack: (pack: Pack) => void;
  onTryIt: (pack: Pack) => void;
}

export function PackDetailSheet({
  pack,
  onClose,
  onCreateFromPack,
  onTryIt,
}: Props) {
  if (!pack) return null;

  const Icon = pack.icon;

  const allSlots = [...pack.included, ...pack.required];
  const skills = allSlots.filter((s) => s.kind === "skill");
  const schedules = allSlots.filter((s) => s.kind === "schedule");
  const setupSlots = allSlots.filter(
    (s) => s.kind !== "skill" && s.kind !== "schedule",
  );

  const setupGroups = SETUP_KIND_ORDER.map((kind) => ({
    kind,
    label: SETUP_GROUP_LABELS[kind] ?? kind,
    slots: setupSlots.filter((s) => s.kind === kind),
  })).filter((g) => g.slots.length > 0);

  return (
    <Modal widthClass="w-[1200px]">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader onClose={onClose} divided>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
                <Icon size={16} className="text-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-semibold text-foreground">
                    {pack.name}
                  </h2>
                  <Badge variant="muted" size="sm">
                    {pack.category}
                  </Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {pack.tagline}
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {pack.description}
            </p>
            <div className="mt-3">
              <PackIngredientSummary pack={pack} />
            </div>

            {(skills.length > 0 || schedules.length > 0) && (
              <div className="mt-6">
                <p className="mb-3 text-base font-semibold text-foreground">
                  Included
                </p>

                {skills.length > 0 && (
                  <div className="mb-4">
                    <SectionLabel spaced>Skills</SectionLabel>
                    <div className="flex flex-col gap-2">
                      {skills.map((s) => (
                        <SkillRow key={s.label} slot={s} />
                      ))}
                    </div>
                  </div>
                )}

                {schedules.length > 0 && (
                  <div>
                    <SectionLabel spaced>Schedules</SectionLabel>
                    <div className="flex flex-col gap-2">
                      {schedules.map((s) => (
                        <ScheduleRow key={s.label} slot={s} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {setupGroups.length > 0 && (
              <div className="mt-6">
                <p className="mb-3 text-base font-semibold text-foreground">
                  You'll set up
                </p>
                <div className="flex flex-col gap-4">
                  {setupGroups.map((group) => (
                    <div key={group.kind}>
                      <SectionLabel spaced>{group.label}</SectionLabel>
                      <div className="flex flex-col gap-2">
                        {group.slots.map((s) => (
                          <SetupSlotRow key={`${s.kind}-${s.label}`} slot={s} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onTryIt(pack)}>
              Try Demo
            </Button>
            <Button onClick={() => onCreateFromPack(pack)}>
              Create an agent from this Preset
            </Button>
          </DialogFooter>
        </div>

        <div className="hidden w-1/2 shrink-0 flex-col items-center justify-center border-l border-border bg-preset-light md:flex">
          <PlayFilledAlt size={48} className="text-preset/30" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            See it in action
          </p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Video coming soon
          </p>
        </div>
      </div>
    </Modal>
  );
}

function SkillRow({ slot }: { slot: PackSlot }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{slot.label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {slot.description}
        </p>
      </div>
      <button
        type="button"
        className="mt-0.5 flex shrink-0 items-center gap-1 text-sm text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label={`View ${slot.label} on GitHub`}
      >
        <Launch size={16} />
      </button>
    </div>
  );
}

function ScheduleRow({ slot }: { slot: PackSlot }) {
  const rruleText = slot.demoValue?.startsWith("RRULE:")
    ? rruleToText(slot.demoValue)
    : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
      <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
        <Time size={16} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{slot.label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {slot.description}
        </p>
        {rruleText && (
          <p className="mt-1 text-sm text-muted-foreground/60">{rruleText}</p>
        )}
      </div>
    </div>
  );
}

const HARNESS_ICON_SRC: Record<string, string> = {
  "claude-code": "/icons/claude-code.svg",
  "pi-agent": "/icons/pi-agent.svg",
};

const HARNESS_PRESET: Record<string, "openai" | "bob"> = {
  codex: "openai",
  bob: "bob",
};

const KIND_FALLBACK_ICONS: Partial<Record<PackIngredientKind, CarbonIconType>> =
  {
    connection: ConnectionSignal,
    channel: Chat,
    "knowledge-base": Notebook,
    harness: Box,
    framework: Box,
    "starter-repo": Code,
  };

function resolveIconSlug(slot: PackSlot): string | null {
  const label = slot.label.toLowerCase();
  if (label === "github" || slot.templateId === "github") return "github";
  if (label === "slack" || slot.templateId === "slack") return "slack";
  if (label === "kubernetes" || slot.templateId === "kubernetes")
    return "kubernetes";
  return null;
}

const SVG_SLUGS = new Set(["slack", "kubernetes"]);

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
      {children}
    </div>
  );
}

function SetupSlotIcon({ slot }: { slot: PackSlot }) {
  if (slot.kind === "harness" || slot.kind === "framework") {
    const tplId = slot.templateId ?? "";
    const iconSrc = HARNESS_ICON_SRC[tplId];
    if (iconSrc) {
      return (
        <img
          src={iconSrc}
          alt={slot.label}
          width={38}
          height={38}
          className="shrink-0 rounded-lg"
        />
      );
    }
    const preset = HARNESS_PRESET[tplId];
    if (preset) {
      return <CardIcon provider={preset} size="md" />;
    }
    return (
      <IconTile>
        <Box size={16} className="text-muted-foreground" />
      </IconTile>
    );
  }

  const iconSlug = resolveIconSlug(slot);
  if (iconSlug === "github") {
    return (
      <IconTile>
        <GithubIcon width={16} height={16} className="block" />
      </IconTile>
    );
  }
  if (iconSlug && SVG_SLUGS.has(iconSlug)) {
    return (
      <IconTile>
        <img
          src={`/icons/${iconSlug}.svg`}
          alt={slot.label}
          width={16}
          height={16}
          className="block"
        />
      </IconTile>
    );
  }

  const FallbackIcon = KIND_FALLBACK_ICONS[slot.kind] ?? ConnectionSignal;
  return (
    <IconTile>
      <FallbackIcon size={16} className="text-muted-foreground" />
    </IconTile>
  );
}

function SetupSlotRow({ slot }: { slot: PackSlot }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
      <SetupSlotIcon slot={slot} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{slot.label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {slot.description}
        </p>
      </div>
    </div>
  );
}
