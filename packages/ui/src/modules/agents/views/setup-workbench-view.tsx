import {
  Add,
  Close,
  Gift,
  Launch,
  OverflowMenuHorizontal,
  TrashCan,
} from "@carbon/icons-react";
import type {
  AuthKind,
  ConnectionStatus,
  ConnectionView,
  SkillSource,
} from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";

import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Inset } from "@/components/ui/inset";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import {
  catalogProviderTitle,
  connectionKindSubtitle,
} from "../../connections/lib/catalog-providers.js";
import { PackIngredientSummary } from "../../packs/components/pack-ingredient-summary.js";
import type { Pack, PackSlot } from "../../packs/data/packs.js";
import { usePacks } from "../../packs/hooks/use-packs.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import {
  EMPTY_REGISTRY_CREDENTIAL,
  type RegistryCredential,
} from "../../sandboxes/components/registry-credential-section.js";
import { ImageSection } from "../../sandboxes/components/setup/image-section.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { AddSkillSourceModal } from "../../sandboxes/components/skills/add-skill-source-modal.js";
import type { ScheduleDraft } from "../../sandboxes/hooks/use-setup-form.js";
import {
  imageCatalogue,
  KINDED_HARNESS_TEMPLATE_ID,
} from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { ScheduleSetupSection } from "../../schedules/components/schedule-setup-section.js";
import { scheduleFormDefaults } from "../../schedules/forms/schedule-form-schema.js";
import { useTemplates } from "../../templates/api/queries.js";
import {
  ChannelsSetupSection,
  ConnectedRecommendationCard,
  PresetBar,
  RecommendedCard,
  SkillsSetupSection,
} from "./agent-setup-view.js";

export function SetupWorkbenchView() {
  const packs = usePacks();
  const samplePack = packs[0]!;
  return (
    <div>
      <PageHeader
        title="Setup Sections Workbench"
        description="Every agent setup section in three states — empty, filled manually, and with a starter kit applied. Stacked vertically so each renders at full width."
      />

      <div className="mb-8 flex items-center gap-2">
        <Badge variant="muted">Pack</Badge>
        <span className="text-sm text-foreground">{samplePack.name}</span>
        <span className="text-sm text-muted-foreground">
          — used for the Starter Kit column
        </span>
      </div>

      <div className="mx-auto flex max-w-[960px] flex-col gap-14">
        <SectionGroup label="Starter Kit Bar">
          <StateBlock label="Empty">
            <PresetBarEmpty />
          </StateBlock>
          <StateBlock label="Filled (manual)">
            <PresetBarFilled />
          </StateBlock>
          <StateBlock label="With Starter Kit">
            <PresetBarPreset pack={samplePack} />
          </StateBlock>
        </SectionGroup>

        <SectionGroup label="Name">
          <StateBlock label="Empty">
            <NameEmpty />
          </StateBlock>
          <StateBlock label="Filled (manual)">
            <NameFilled />
          </StateBlock>
          <StateBlock label="With Starter Kit">
            <NamePreset />
          </StateBlock>
        </SectionGroup>

        <SectionGroup label="Schedules">
          <StateBlock label="Empty">
            <ScheduleColumnEmpty />
          </StateBlock>
          <StateBlock label="Filled (manual)">
            <ScheduleColumnFilled />
          </StateBlock>
          <StateBlock label="With Starter Kit">
            <ScheduleColumnPreset pack={samplePack} />
          </StateBlock>
        </SectionGroup>

        <SectionGroup label="Connections">
          <StateBlock label="Empty">
            <ConnectionsColumnEmpty />
          </StateBlock>
          <StateBlock label="Filled (manual)">
            <ConnectionsColumnFilled />
          </StateBlock>
          <StateBlock label="With Starter Kit">
            <ConnectionsColumnPreset pack={samplePack} />
          </StateBlock>
        </SectionGroup>

        <SectionGroup label="Connected Starter Kit Connections">
          <StateBlock label="GitHub OAuth (active)">
            <ConnectedRecommendationDemo authKind="oauth" status="active" />
          </StateBlock>
          <StateBlock label="GitHub PAT (active)">
            <ConnectedRecommendationDemo authKind="header" status="active" />
          </StateBlock>
          <StateBlock label="GitHub App (active)">
            <ConnectedRecommendationDemo
              authKind="github-app"
              status="active"
            />
          </StateBlock>
          <StateBlock label="GitHub OAuth (expired)">
            <ConnectedRecommendationDemo authKind="oauth" status="expired" />
          </StateBlock>
        </SectionGroup>

        <SectionGroup label="Skills">
          <StateBlock label="Empty">
            <SkillsColumnEmpty />
          </StateBlock>
          <StateBlock label="Filled (manual)">
            <SkillsColumnFilled />
          </StateBlock>
          <StateBlock label="With Starter Kit">
            <SkillsColumnPreset pack={samplePack} />
          </StateBlock>
        </SectionGroup>

        <SectionGroup label="Channels">
          <StateBlock label="Empty">
            <ChannelsColumnEmpty />
          </StateBlock>
          <StateBlock label="Filled (manual)">
            <ChannelsColumnFilled />
          </StateBlock>
          <StateBlock label="With Starter Kit">
            <ChannelsColumnPreset pack={samplePack} />
          </StateBlock>
        </SectionGroup>
      </div>
    </div>
  );
}

function SectionGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h2>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

function StateBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted-foreground">{label}</p>
      <div className="rounded-lg border border-border/50 bg-card/50 px-12 py-6">
        {children}
      </div>
    </div>
  );
}

function PresetBarEmpty() {
  return (
    <Inset>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-preset-border/50">
          <Gift size={16} className="text-preset" />
        </div>
        <p className="flex-1 text-sm text-foreground/70">
          Want a head start? Pick a starter kit to pre-fill harness, skills, and
          connections.
        </p>
        <Button variant="outline" size="sm">
          Browse starter kits
        </Button>
      </div>
    </Inset>
  );
}

function PresetBarFilled() {
  return (
    <Inset>
      <div className="flex items-center gap-3 rounded-lg border border-muted bg-muted/30 px-4 py-4">
        <p className="flex-1 text-sm text-muted-foreground">
          No starter kit — sections were filled manually
        </p>
      </div>
    </Inset>
  );
}

function PresetBarPreset({ pack }: { pack: Pack }) {
  return (
    <Inset>
      <div className="flex items-center gap-3 rounded-lg border border-preset-border/50 bg-preset-light/50 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-preset-border/50">
          <Gift size={16} className="text-preset" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-preset">{pack.name}</p>
          <div className="mt-0.5">
            <PackIngredientSummary pack={pack} />
          </div>
        </div>
        <Button variant="outline" size="sm">
          Change
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Close size={16} />
        </Button>
      </div>
    </Inset>
  );
}

function NameEmpty() {
  const [name, setName] = useState("");
  return <NameSection value={name} onChange={setName} />;
}

function NameFilled() {
  const [name, setName] = useState("my-release-bot");
  return <NameSection value={name} onChange={setName} />;
}

function NamePreset() {
  const [name, setName] = useState("docs-maintainer-1");
  const [fromPreset, setFromPreset] = useState(true);

  return (
    <section className="mb-8">
      <FormField label="Name">
        <div className="relative">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFromPreset(false);
            }}
            className={cn(
              "h-10 w-full rounded-lg border px-3 text-sm text-foreground",
              fromPreset
                ? "border-preset-border/50 bg-preset-light/50 pr-9"
                : "border-border bg-card",
            )}
          />
          {fromPreset && (
            <button
              type="button"
              onClick={() => {
                setName("");
                setFromPreset(false);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              aria-label="Clear starter kit name"
            >
              <Close size={16} />
            </button>
          )}
        </div>
      </FormField>
    </section>
  );
}

function useSharedImageData() {
  const { data: templates, isLoading } = useTemplates();
  const catalogue = useMemo(
    () => imageCatalogue(templates ?? [], { vmFeatureEnabled: false }),
    [templates],
  );
  return { harnesses: catalogue.harnesses, loading: isLoading };
}

function ImageColumnEmpty() {
  const { harnesses, loading } = useSharedImageData();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [customImage, setCustomImage] = useState("");
  const [registry, setRegistry] = useState<RegistryCredential>(
    EMPTY_REGISTRY_CREDENTIAL,
  );

  return (
    <ImageSection
      harnesses={harnesses}
      loading={loading}
      templateId={templateId}
      customImage={customImage}
      registry={{
        value: registry,
        onChange: setRegistry,
        partial: false,
        disclosureOverride: null,
        onDisclosureOverride: () => {},
      }}
      onPickTemplate={setTemplateId}
      onCustomImageChange={setCustomImage}
      onSubmit={() => {}}
    />
  );
}

function ImageColumnFilled() {
  const { harnesses, loading } = useSharedImageData();
  const [templateId, setTemplateId] = useState<string | null>(
    KINDED_HARNESS_TEMPLATE_ID,
  );
  const [customImage, setCustomImage] = useState("");
  const [registry, setRegistry] = useState<RegistryCredential>(
    EMPTY_REGISTRY_CREDENTIAL,
  );

  return (
    <ImageSection
      harnesses={harnesses}
      loading={loading}
      templateId={templateId}
      customImage={customImage}
      registry={{
        value: registry,
        onChange: setRegistry,
        partial: false,
        disclosureOverride: null,
        onDisclosureOverride: () => {},
      }}
      onPickTemplate={setTemplateId}
      onCustomImageChange={setCustomImage}
      onSubmit={() => {}}
    />
  );
}

function ImageColumnPreset({ pack }: { pack: Pack }) {
  const { harnesses, loading } = useSharedImageData();
  const harnessSlot = useMemo(
    () =>
      [...pack.included, ...pack.required].find((s) => s.kind === "harness"),
    [pack],
  );
  const [templateId, setTemplateId] = useState<string | null>(
    harnessSlot?.templateId ?? KINDED_HARNESS_TEMPLATE_ID,
  );
  const [customImage, setCustomImage] = useState("");
  const [registry, setRegistry] = useState<RegistryCredential>(
    EMPTY_REGISTRY_CREDENTIAL,
  );

  return (
    <ImageSection
      harnesses={harnesses}
      loading={loading}
      templateId={templateId}
      customImage={customImage}
      registry={{
        value: registry,
        onChange: setRegistry,
        partial: false,
        disclosureOverride: null,
        onDisclosureOverride: () => {},
      }}
      onPickTemplate={setTemplateId}
      onCustomImageChange={setCustomImage}
      onSubmit={() => {}}
    />
  );
}

function ProviderColumnEmpty() {
  const [selected, setSelected] = useState<ProviderRef | null>(null);
  const policy = setupProviderPolicy("coding-agent");
  return (
    <ProviderSection
      selected={selected}
      onSelect={setSelected}
      policy={policy}
    />
  );
}

function ProviderColumnFilled() {
  const [selected, setSelected] = useState<ProviderRef | null>(null);
  const policy = setupProviderPolicy("coding-agent");
  return (
    <ProviderSection
      selected={selected}
      onSelect={setSelected}
      policy={policy}
    />
  );
}

function ProviderColumnPreset() {
  const [selected, setSelected] = useState<ProviderRef | null>(null);
  const policy = setupProviderPolicy("coding-agent");
  return (
    <ProviderSection
      selected={selected}
      onSelect={setSelected}
      policy={policy}
    />
  );
}

function ScheduleColumnEmpty() {
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
  return <ScheduleSetupSection drafts={drafts} onDraftsChange={setDrafts} />;
}

function ScheduleColumnFilled() {
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([
    {
      ...scheduleFormDefaults(),
      name: "Weekly sync",
      task: "Review open PRs and summarize status",
      enabled: true,
    },
  ]);
  return <ScheduleSetupSection drafts={drafts} onDraftsChange={setDrafts} />;
}

function ScheduleColumnPreset({ pack }: { pack: Pack }) {
  const scheduleSlots = useMemo(
    () =>
      [...pack.included, ...pack.required].filter((s) => s.kind === "schedule"),
    [pack],
  );

  const presetDrafts = useMemo<ScheduleDraft[]>(
    () =>
      scheduleSlots.map((s) => ({
        name: s.label,
        task: s.description,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        sessionMode: "fresh" as const,
        kind: "daily" as const,
        interval: "1",
        time: "09:00",
        days: [1, 2, 3, 4, 5],
        customRRule: s.demoValue ?? "",
        quietHours: [],
        enabled: true,
        recommendation: {
          summary:
            "This schedule should run before your first meeting of the day so the agent can prepare context ahead of time",
          fields: {
            time: "Before your first meeting — try 30 min ahead",
            days: "Workdays, when your team is active",
            sessionMode: "Fresh recommended for daily prep tasks",
          },
        },
      })),
    [scheduleSlots],
  );

  const [userDrafts, setUserDrafts] = useState<ScheduleDraft[]>([]);
  const allDrafts = useMemo(
    () => [...presetDrafts, ...userDrafts],
    [presetDrafts, userDrafts],
  );
  const presetIndices = useMemo(
    () => new Set(Array.from({ length: presetDrafts.length }, (_, i) => i)),
    [presetDrafts],
  );

  return (
    <ScheduleSetupSection
      drafts={allDrafts}
      onDraftsChange={(next) => setUserDrafts(next.slice(presetDrafts.length))}
      presetIndices={presetIndices}
    />
  );
}

function ConnectionsColumnEmpty() {
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  return (
    <ConnectionsSetupSection
      connectionIds={connectionIds}
      onToggle={(id, granted) =>
        setConnectionIds((prev) =>
          granted ? [...prev, id] : prev.filter((x) => x !== id),
        )
      }
      oauthReturnView="/setup-workbench"
    />
  );
}

function ConnectionsColumnFilled() {
  const connectionsQ = useAppConnections();
  const allIds = useMemo(
    () => (connectionsQ.data ?? []).map((c) => c.id),
    [connectionsQ.data],
  );
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const seeded = useRef(false);

  useEffect(() => {
    if (allIds.length > 0 && !seeded.current) {
      seeded.current = true;
      setConnectionIds(allIds);
    }
  }, [allIds]);

  return (
    <ConnectionsSetupSection
      connectionIds={connectionIds}
      onToggle={(id, granted) =>
        setConnectionIds((prev) =>
          granted ? [...prev, id] : prev.filter((x) => x !== id),
        )
      }
      oauthReturnView="/setup-workbench"
    />
  );
}

function ConnectionsColumnPreset({ pack }: { pack: Pack }) {
  const { data: userConnections } = useAppConnections();
  const { data: connectionTemplatesData } = useConnectionTemplates();

  const connectionTemplateIconMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of connectionTemplatesData ?? []) {
      if (t.iconSlug) map.set(t.id, t.iconSlug);
    }
    return map;
  }, [connectionTemplatesData]);

  const userConnectionTemplateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of userConnections ?? []) {
      if (c.templateId) map.set(c.id, c.templateId);
    }
    return map;
  }, [userConnections]);

  const recommendedSlots = useMemo(
    () =>
      [...pack.required, ...pack.included].filter(
        (s) => s.kind === "connection" || s.kind === "knowledge-base",
      ),
    [pack],
  );

  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [catalogOpen, setCatalogOpen] = useState<string | boolean>(false);
  const visible = useMemo(
    () =>
      recommendedSlots.filter((s) => !dismissed.has(`${s.kind}-${s.label}`)),
    [recommendedSlots, dismissed],
  );

  const { unfulfilledSlots, fulfilledSlots } = useMemo(() => {
    const grantedTemplateIds = new Set(
      connectionIds
        .map((id) => userConnectionTemplateMap.get(id))
        .filter(Boolean),
    );
    const unfulfilled: PackSlot[] = [];
    const fulfilled: { slot: PackSlot; connection: ConnectionView }[] = [];
    for (const slot of visible) {
      if (!slot.connectionTemplateId) {
        unfulfilled.push(slot);
        continue;
      }
      if (grantedTemplateIds.has(slot.connectionTemplateId)) {
        const conn = (userConnections ?? []).find(
          (c) =>
            c.templateId === slot.connectionTemplateId &&
            connectionIds.includes(c.id),
        );
        if (conn) {
          fulfilled.push({ slot, connection: conn });
          continue;
        }
      }
      unfulfilled.push(slot);
    }
    return { unfulfilledSlots: unfulfilled, fulfilledSlots: fulfilled };
  }, [visible, connectionIds, userConnectionTemplateMap, userConnections]);

  const fulfilledConnectionIds = useMemo(
    () =>
      fulfilledSlots.length > 0
        ? new Set(fulfilledSlots.map((f) => f.connection.id))
        : undefined,
    [fulfilledSlots],
  );

  const iconSlugForSlot = (slot: PackSlot) =>
    slot.connectionTemplateId
      ? connectionTemplateIconMap.get(slot.connectionTemplateId)
      : undefined;

  return (
    <>
      <ConnectionsSetupSection
        connectionIds={connectionIds}
        onToggle={(id, granted) =>
          setConnectionIds((prev) =>
            granted ? [...prev, id] : prev.filter((x) => x !== id),
          )
        }
        oauthReturnView="/setup-workbench"
        excludeIds={fulfilledConnectionIds}
      >
        {(unfulfilledSlots.length > 0 || fulfilledSlots.length > 0) && (
          <div className="flex flex-col gap-3">
            {fulfilledSlots.map(({ slot, connection }) => (
              <ConnectedRecommendationCard
                key={`${slot.kind}-${slot.label}`}
                connection={connection}
                subtitle={connectionKindSubtitle(
                  connection,
                  connectionTemplatesData?.find(
                    (t) => t.id === connection.templateId,
                  ),
                )}
                providerTitle={catalogProviderTitle(connection.templateId)}
                iconSlug={iconSlugForSlot(slot)}
                grant={{
                  granted: true,
                  onToggle: (on) => {
                    setConnectionIds((prev) =>
                      on
                        ? [...prev, connection.id]
                        : prev.filter((x) => x !== connection.id),
                    );
                  },
                  actionHidden: true,
                }}
              />
            ))}
            {unfulfilledSlots.map((slot) => (
              <RecommendedCard
                key={`${slot.kind}-${slot.label}`}
                slot={slot}
                iconSlug={iconSlugForSlot(slot)}
                packName={pack.name}
                onAdd={() => setCatalogOpen(slot.connectionTemplateId ?? true)}
                onDismiss={() =>
                  setDismissed(
                    (prev) => new Set([...prev, `${slot.kind}-${slot.label}`]),
                  )
                }
              />
            ))}
          </div>
        )}
      </ConnectionsSetupSection>
      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{
            grantedIds: new Set(connectionIds),
            onToggleGrant: (id, on) =>
              setConnectionIds((prev) =>
                on ? [...prev, id] : prev.filter((x) => x !== id),
              ),
          }}
          oauthReturnView="/setup-workbench"
          initialTemplateId={
            typeof catalogOpen === "string" ? catalogOpen : undefined
          }
        />
      )}
    </>
  );
}

const DEMO_CONNECTIONS: Record<
  string,
  {
    name: string;
    subtitle: string;
    authKind: AuthKind;
    templateId: string;
    githubAppScope?: {
      repositories: string[];
      permissions: Record<string, string>;
    };
  }
> = {
  oauth: {
    name: "acme-org GitHub (OAuth)",
    subtitle: "GitHub app",
    authKind: "oauth",
    templateId: "github",
  },
  header: {
    name: "ci-bot PAT",
    subtitle: "Personal access token",
    authKind: "header",
    templateId: "github-pat",
  },
  "github-app": {
    name: "Platform Deploy Bot",
    subtitle: "GitHub App — 2 repos, contents:read, pull_requests:write",
    authKind: "github-app",
    templateId: "github-app",
    githubAppScope: {
      repositories: ["platform", "infra-config"],
      permissions: { contents: "read", pull_requests: "write" },
    },
  },
};

function ConnectedRecommendationDemo({
  authKind,
  status,
}: {
  authKind: AuthKind;
  status: ConnectionStatus;
}) {
  const demo = DEMO_CONNECTIONS[authKind]!;
  const connection = {
    id: `demo-${authKind}-${status}`,
    ownerId: "demo-user",
    templateId: demo.templateId,
    category: "app" as const,
    name: demo.name,
    status,
    authKind: demo.authKind,
    contributions: [],
    connectedAt: "2024-06-01T00:00:00.000Z",
    hosts: ["github.com", "api.github.com"],
    host: "github.com",
    appSlug: undefined,
    hasClientSecret: false,
    githubAppScope: demo.githubAppScope,
  };

  return (
    <div className="flex flex-col gap-4">
      <ConnectedRecommendationCard
        connection={connection}
        subtitle={demo.subtitle}
        providerTitle="GitHub"
        iconSlug="github"
        grant={{ granted: true, onToggle: () => {}, actionHidden: true }}
      />
    </div>
  );
}

function SkillsColumnEmpty() {
  const [sources, setSources] = useState<SkillSource[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <SkillsSetupSection
        presetSkills={[]}
        addedSources={sources}
        onDismissPresetSkill={() => {}}
        onRemoveSource={(id) =>
          setSources((prev) => prev.filter((s) => s.id !== id))
        }
        onOpenModal={() => setModalOpen(true)}
      />
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
            setSources((prev) => [...prev, source]);
            setModalOpen(false);
            return source;
          }}
          onCreateSkills={async () => ({ ok: true as const })}
        />
      )}
    </>
  );
}

const MOCK_SOURCE_SKILLS: {
  source: { name: string; slug: string; gitUrl: string; removable: boolean };
  skills: { name: string; on: boolean }[];
}[] = [
  {
    source: {
      name: "release-helper",
      slug: "acme/release-helper · /skills",
      gitUrl: "https://github.com/acme/release-helper",
      removable: true,
    },
    skills: [
      { name: "prepare-changelog", on: true },
      { name: "tag-release", on: true },
      { name: "notify-stakeholders", on: false },
    ],
  },
];

function SkillsColumnFilled() {
  const [sourceSkills, setSourceSkills] = useState(MOCK_SOURCE_SKILLS);

  const toggle = (srcIdx: number, skillIdx: number) =>
    setSourceSkills((prev) =>
      prev.map((src, si) =>
        si !== srcIdx
          ? src
          : {
              ...src,
              skills: src.skills.map((sk, ki) =>
                ki !== skillIdx ? sk : { ...sk, on: !sk.on },
              ),
            },
      ),
    );

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Skills</SectionLabel>
        <Button variant="outline" size="sm">
          <Add size={16} />
          Add source
        </Button>
      </div>
      <Inset className="flex flex-col gap-3">
        {sourceSkills.map((src, si) => {
          const enabledCount = src.skills.filter((s) => s.on).length;
          return (
            <Card key={src.source.name}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[15px] font-semibold text-foreground">
                      {src.source.name}
                    </p>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {enabledCount} of {src.skills.length} on
                    </span>
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {src.source.slug}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Source actions"
                      className="shrink-0 text-muted-foreground"
                    >
                      <OverflowMenuHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem>Re-scan</DropdownMenuItem>
                    <DropdownMenuItem>
                      <span className="flex-1">View repo</span>
                      <Launch size={14} />
                    </DropdownMenuItem>
                    {src.source.removable && (
                      <DropdownMenuItem tone="danger">
                        <TrashCan size={14} />
                        <span className="flex-1">Remove source</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {src.skills.map((sk, ki) => (
                <div
                  key={sk.name}
                  className={cn(
                    "flex items-center gap-3 border-t border-border px-4 py-2",
                    sk.on && "bg-muted/40",
                  )}
                >
                  <p className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">
                    {sk.name}
                  </p>
                  <Switch
                    checked={sk.on}
                    onCheckedChange={() => toggle(si, ki)}
                    label={sk.name}
                  />
                </div>
              ))}
            </Card>
          );
        })}
      </Inset>
    </section>
  );
}

function SkillsColumnPreset({ pack }: { pack: Pack }) {
  const skillSlots = useMemo(
    () =>
      [...pack.included, ...pack.required].filter((s) => s.kind === "skill"),
    [pack],
  );

  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const isOn = (label: string) => toggles[label] ?? true;
  const toggle = (label: string) =>
    setToggles((prev) => ({ ...prev, [label]: !isOn(label) }));

  const enabledCount = skillSlots.filter((s) => isOn(s.label)).length;

  const [blockDismissed, setBlockDismissed] = useState(false);

  const [sources, setSources] = useState<SkillSource[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>Skills</SectionLabel>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModalOpen(true)}
          >
            <Add size={16} />
            Add source
          </Button>
        </div>
        <Inset className="flex flex-col gap-3">
          {!blockDismissed && skillSlots.length > 0 && (
            <Card className="overflow-hidden border-preset-border/50 bg-preset-light/50">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[15px] font-semibold text-foreground">
                      {pack.name.toLowerCase().replace(/\s+/g, "-")}
                    </p>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {enabledCount} of {skillSlots.length} on
                    </span>
                    <Badge variant="preset">Starter Kit</Badge>
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    acme/{pack.name.toLowerCase().replace(/\s+/g, "-")} ·
                    /skills
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:bg-preset-border/50 hover:text-foreground"
                  onClick={() => setBlockDismissed(true)}
                  aria-label="Dismiss starter kit skills"
                >
                  <Close size={16} />
                </Button>
              </div>
              {skillSlots.map((slot) => (
                <div
                  key={slot.label}
                  className={cn(
                    "flex items-center gap-3 border-t border-preset-border/30 px-4 py-2",
                    isOn(slot.label) && "bg-preset-light/30",
                  )}
                >
                  <p className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">
                    {slot.label.toLowerCase().replace(/\s+/g, "-")}
                  </p>
                  <Switch
                    checked={isOn(slot.label)}
                    onCheckedChange={() => toggle(slot.label)}
                    label={slot.label}
                  />
                </div>
              ))}
            </Card>
          )}
          {sources.map((source) => (
            <Card key={source.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-foreground">
                    {source.name}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {source.gitUrl}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setSources((prev) => prev.filter((s) => s.id !== source.id))
                  }
                  aria-label={`Remove ${source.name}`}
                >
                  <TrashCan size={16} />
                </Button>
              </div>
            </Card>
          ))}
        </Inset>
      </section>
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
            setSources((prev) => [...prev, source]);
            setModalOpen(false);
            return source;
          }}
          onCreateSkills={async () => ({ ok: true as const })}
        />
      )}
    </>
  );
}

function ChannelsColumnEmpty() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <ChannelsSetupSection
      presetChannels={[]}
      selectedChannels={selected}
      onToggleChannel={(label) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(label)) next.delete(label);
          else next.add(label);
          return next;
        })
      }
    />
  );
}

function ChannelsColumnFilled() {
  const [selected, setSelected] = useState<Set<string>>(new Set(["Slack"]));
  return (
    <ChannelsSetupSection
      presetChannels={[]}
      selectedChannels={selected}
      onToggleChannel={(label) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(label)) next.delete(label);
          else next.add(label);
          return next;
        })
      }
    />
  );
}

function ChannelsColumnPreset({ pack }: { pack: Pack }) {
  const channelSlots = useMemo(
    () =>
      [...pack.included, ...pack.required].filter((s) => s.kind === "channel"),
    [pack],
  );

  const presetChannelLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const slot of channelSlots) {
      const text =
        `${slot.label} ${slot.description} ${slot.demoValue ?? ""}`.toLowerCase();
      if (text.includes("slack") || text.includes("#")) labels.add("Slack");
      if (text.includes("telegram")) labels.add("Telegram");
    }
    return labels;
  }, [channelSlots]);

  const [selected, setSelected] = useState<Set<string>>(presetChannelLabels);

  return (
    <ChannelsSetupSection
      presetChannels={channelSlots}
      selectedChannels={selected}
      onToggleChannel={(label) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(label)) next.delete(label);
          else next.add(label);
          return next;
        })
      }
    />
  );
}
