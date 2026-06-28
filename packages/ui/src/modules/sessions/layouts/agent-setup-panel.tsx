import {
  Bot,
  Checkmark,
  ChevronDown,
  ChevronRight,
  Code,
  Extensions,
  Globe,
} from "@carbon/icons-react";
import { Settings } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { ConfigPanelVariant } from "../../../store.js";
import { useStore } from "../../../store.js";
import type { ProviderPresetType } from "../../../types.js";
import { OAuthAppIcon } from "../../connections/components/oauth-app-icon.js";
import { PROVIDER_DESCRIPTIONS } from "../../settings/components/provider-chooser-dialog.js";
import { CardIcon } from "../../settings/components/shared/card-icon.js";

// ── Harness definitions (same as starting-point-section) ───────────────────────

interface HarnessEntry {
  id: string;
  name: string;
  model: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const HARNESSES: HarnessEntry[] = [
  { id: "claude-code", name: "Claude Code", model: "Claude", icon: Code },
  { id: "codex", name: "Codex", model: "OpenAI", icon: Extensions },
  {
    id: "ibm-bob",
    name: "IBM Bob",
    model: "Claude · Mistral · Granite",
    icon: Bot,
  },
  { id: "pi-agent", name: "Pi Agent", model: "Any provider", icon: Globe },
];

// ── Provider definitions ───────────────────────────────────────────────────────

interface ProviderOption {
  type: ProviderPresetType;
  name: string;
  description: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    type: "ibm-litellm",
    name: "IBM watsonx",
    description: PROVIDER_DESCRIPTIONS["ibm-litellm"],
  },
  {
    type: "anthropic",
    name: "Anthropic",
    description: PROVIDER_DESCRIPTIONS["anthropic"],
  },
  {
    type: "openai",
    name: "OpenAI",
    description: PROVIDER_DESCRIPTIONS["openai"],
  },
  { type: "bob", name: "BeeAI", description: PROVIDER_DESCRIPTIONS["bob"] },
];

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_CONNECTIONS = [
  {
    id: "conn-1",
    templateId: "github",
    name: "GitHub — acme-org",
    status: "active" as const,
  },
  {
    id: "conn-2",
    templateId: "slack",
    name: "Slack — #eng-team",
    status: "active" as const,
  },
  {
    id: "conn-3",
    templateId: "jira",
    name: "Jira — Platform board",
    status: "active" as const,
  },
];

const MOCK_SYSTEM_PROMPT = `You are a senior software engineer working on a Kubernetes platform. Follow best practices for Go and TypeScript. Always explain your reasoning before making changes. Use conventional commits.`;

const MOCK_SKILLS = ["Code Search", "File Editor", "Terminal", "Web Browser"];

const MOCK_ENV_VARS = [
  { key: "NODE_ENV", value: "development" },
  { key: "LOG_LEVEL", value: "debug" },
  { key: "API_TIMEOUT", value: "30000" },
];

const MOCK_SCHEDULE = { cron: "0 9 * * 1-5", label: "Weekdays at 9:00 AM" };

const MOCK_NETWORK = { policy: "restricted" as const, domains: 3 };

// ── Field label (matches FormField pattern) ────────────────────────────────────

function FieldLabel({
  label,
  settingsLink,
}: {
  label: string;
  settingsLink?: boolean;
}) {
  const setView = useStore((s) => s.setView);

  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {settingsLink && (
        <button
          onClick={() => setView("settings")}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings size={10} />
          Manage
        </button>
      )}
    </div>
  );
}

// ── Section: Name ──────────────────────────────────────────────────────────────

function NameSection() {
  const [name, setName] = useState("platform-engineer");

  return (
    <div>
      <FieldLabel label="Name" />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="my-agent"
        autoComplete="off"
      />
    </div>
  );
}

// ── Section: Harness ───────────────────────────────────────────────────────────

function HarnessSection() {
  const [selected, setSelected] = useState("claude-code");

  return (
    <div>
      <FieldLabel label="Harness" />
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger>
          <SelectValue placeholder="Select a harness…" />
        </SelectTrigger>
        <SelectContent>
          {HARNESSES.map((h) => (
            <SelectItem key={h.id} value={h.id}>
              <span className="flex items-center gap-2">
                <h.icon size={14} className="text-muted-foreground" />
                {h.name}
                <span className="text-[11px] text-muted-foreground">
                  {h.model}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Section: Provider ──────────────────────────────────────────────────────────

function ProviderSection() {
  const [selected, setSelected] = useState<ProviderPresetType>("ibm-litellm");

  return (
    <div>
      <FieldLabel label="Provider" settingsLink />
      <div className="flex flex-col gap-2">
        {PROVIDER_OPTIONS.map((p) => {
          const isSelected = selected === p.type;
          return (
            <button
              key={p.type}
              type="button"
              onClick={() => setSelected(p.type)}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                "hover:border-foreground/30 hover:bg-muted/30",
                isSelected && "border-foreground bg-muted/20",
              )}
            >
              <CardIcon provider={p.type} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">
                    {p.name}
                  </span>
                  {isSelected && (
                    <Checkmark size={12} className="text-emerald-500" />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  {p.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Section: Connections ────────────────────────────────────────────────────────

function ConnectionsSection() {
  return (
    <div>
      <FieldLabel label="Connections" settingsLink />
      <div className="flex flex-col gap-1.5">
        {MOCK_CONNECTIONS.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5"
          >
            <OAuthAppIcon appId={c.templateId} alt={c.name} size={16} />
            <span className="text-[12px] font-medium text-foreground flex-1 truncate">
              {c.name}
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section: System Prompt ──────────────────────────────────────────────────────

function SystemPromptSection() {
  return (
    <div>
      <FieldLabel label="System Prompt" />
      <p className="text-[12px] text-foreground/80 leading-relaxed">
        {MOCK_SYSTEM_PROMPT}
      </p>
    </div>
  );
}

// ── Section: Skills ─────────────────────────────────────────────────────────────

function SkillsSection() {
  return (
    <div>
      <FieldLabel label="Skills" />
      <div className="flex flex-wrap gap-1.5">
        {MOCK_SKILLS.map((name) => (
          <span
            key={name}
            className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-foreground"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Section: Schedule ───────────────────────────────────────────────────────────

function ScheduleSection() {
  return (
    <div>
      <FieldLabel label="Schedule" />
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-foreground">
          {MOCK_SCHEDULE.label}
        </span>
        <span className="text-[11px] text-muted-foreground font-mono">
          {MOCK_SCHEDULE.cron}
        </span>
      </div>
    </div>
  );
}

// ── Section: Network ────────────────────────────────────────────────────────────

function NetworkSection() {
  return (
    <div>
      <FieldLabel label="Network" />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            MOCK_NETWORK.policy === "restricted"
              ? "bg-amber-400"
              : "bg-emerald-400",
          )}
        />
        <span className="text-[12px] text-foreground capitalize">
          {MOCK_NETWORK.policy}
        </span>
        <span className="text-[11px] text-muted-foreground">
          · {MOCK_NETWORK.domains} allowed domains
        </span>
      </div>
    </div>
  );
}

// ── Section: Environment ────────────────────────────────────────────────────────

function EnvSection() {
  return (
    <div>
      <FieldLabel label="Environment" />
      <div className="flex flex-col gap-0.5">
        {MOCK_ENV_VARS.map((v) => (
          <span
            key={v.key}
            className="text-[11px] font-mono text-foreground/70"
          >
            {v.key}={v.value}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Variant A: Grouped ─────────────────────────────────────────────────────────

function SectionGroup({
  label,
  children,
  collapsible,
  defaultOpen = true,
}: {
  label: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={collapsible ? () => setOpen(!open) : undefined}
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground",
          collapsible &&
            "cursor-pointer hover:text-foreground transition-colors",
        )}
      >
        {collapsible &&
          (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        {label}
      </button>
      {open && <div className="flex flex-col gap-5">{children}</div>}
    </div>
  );
}

function AgentSetupGrouped() {
  return (
    <div className="flex flex-col gap-7">
      <SectionGroup label="Identity">
        <NameSection />
        <HarnessSection />
      </SectionGroup>

      <div className="border-t border-border" />

      <SectionGroup label="Access">
        <ProviderSection />
        <ConnectionsSection />
      </SectionGroup>

      <div className="border-t border-border" />

      <SectionGroup label="Behavior">
        <SystemPromptSection />
        <SkillsSection />
        <ScheduleSection />
      </SectionGroup>

      <div className="border-t border-border" />

      <SectionGroup label="Security" collapsible defaultOpen={false}>
        <NetworkSection />
        <EnvSection />
      </SectionGroup>
    </div>
  );
}

// ── Variant B: Tabbed ──────────────────────────────────────────────────────────

function AgentSetupTabbed() {
  return (
    <Tabs defaultValue="agent" className="flex flex-col gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="agent" className="flex-1 text-xs">
          Agent
        </TabsTrigger>
        <TabsTrigger value="workflow" className="flex-1 text-xs">
          Workflow
        </TabsTrigger>
      </TabsList>
      <TabsContent value="agent" className="flex flex-col gap-7 mt-0">
        <NameSection />
        <HarnessSection />
        <ProviderSection />
        <ConnectionsSection />
        <NetworkSection />
        <EnvSection />
      </TabsContent>
      <TabsContent value="workflow" className="flex flex-col gap-7 mt-0">
        <SystemPromptSection />
        <SkillsSection />
        <ScheduleSection />
      </TabsContent>
    </Tabs>
  );
}

// ── Variant C: Context-bar (minimal config panel) ──────────────────────────────

function AgentSetupMinimal() {
  return (
    <div className="flex flex-col gap-7">
      <NameSection />
      <HarnessSection />
      <ProviderSection />
      <ConnectionsSection />
      <SystemPromptSection />
      <NetworkSection />
      <EnvSection />
    </div>
  );
}

// ── Variant D: Accordion ───────────────────────────────────────────────────────

function AccordionSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-3 text-xs font-medium text-foreground hover:text-foreground/80 transition-colors"
      >
        {label}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="pb-4 flex flex-col gap-5">{children}</div>}
    </div>
  );
}

function AgentSetupAccordion() {
  return (
    <div className="flex flex-col">
      <AccordionSection label="Name & Harness" defaultOpen>
        <NameSection />
        <HarnessSection />
      </AccordionSection>
      <AccordionSection label="Provider">
        <ProviderSection />
      </AccordionSection>
      <AccordionSection label="Connections">
        <ConnectionsSection />
      </AccordionSection>
      <AccordionSection label="System Prompt">
        <SystemPromptSection />
      </AccordionSection>
      <AccordionSection label="Skills">
        <SkillsSection />
      </AccordionSection>
      <AccordionSection label="Schedule">
        <ScheduleSection />
      </AccordionSection>
      <AccordionSection label="Network & Environment">
        <NetworkSection />
        <EnvSection />
      </AccordionSection>
    </div>
  );
}

// ── Variant E: Priority ────────────────────────────────────────────────────────

function AgentSetupPriority() {
  const [infraOpen, setInfraOpen] = useState(false);

  return (
    <div className="flex flex-col gap-7">
      <SkillsSection />
      <ScheduleSection />
      <SystemPromptSection />

      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setInfraOpen(!infraOpen)}
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {infraOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Infrastructure
        </button>
        {infraOpen && (
          <div className="flex flex-col gap-7 mt-5">
            <NameSection />
            <HarnessSection />
            <ProviderSection />
            <ConnectionsSection />
            <NetworkSection />
            <EnvSection />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Variant F: One-time only (for sidebar-tabs, header-strip, drawer, detached) ─

function AgentSetupOneTimeOnly() {
  return (
    <div className="flex flex-col gap-7">
      <NameSection />
      <HarnessSection />
      <ProviderSection />
      <ConnectionsSection />
      <NetworkSection />
      <EnvSection />
    </div>
  );
}

// ── Variant toggle (segmented control at top of panel) ─────────────────────────

const VARIANT_LABELS: Record<ConfigPanelVariant, string> = {
  grouped: "Grouped",
  tabbed: "Tabbed",
  "context-bar": "Context",
  accordion: "Accordion",
  priority: "Priority",
  "sidebar-tabs": "SideTabs",
  "header-strip": "Header",
  drawer: "Drawer",
  detached: "Detached",
  nested: "Nested",
};

const ALL_VARIANTS: ConfigPanelVariant[] = [
  "grouped",
  "tabbed",
  "context-bar",
  "accordion",
  "priority",
  "sidebar-tabs",
  "header-strip",
  "drawer",
  "detached",
  "nested",
];

function VariantToggle() {
  const variant = useStore((s) => s.configPanelVariant);
  const setVariant = useStore((s) => s.setConfigPanelVariant);

  return (
    <div className="flex items-center rounded-md bg-muted p-0.5 gap-0.5">
      {ALL_VARIANTS.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setVariant(v)}
          className={cn(
            "px-2 py-1 text-[10px] font-medium rounded-sm transition-colors",
            variant === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {VARIANT_LABELS[v]}
        </button>
      ))}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

interface AgentSetupPanelProps {
  agentId: string | null;
  agentRunning: boolean;
  onOpenFile?: (path: string) => void;
  onResumeSession?: (sessionId: string) => void;
}

export function AgentSetupPanel({
  agentId,
  agentRunning,
}: AgentSetupPanelProps) {
  const configured = Boolean(agentId && agentRunning);
  const variant = useStore((s) => s.configPanelVariant);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Configuration
        </span>
        <VariantToggle />
      </div>
      <div
        className={cn(
          "flex-1 overflow-y-auto px-5 py-5",
          !configured && "opacity-40 pointer-events-none",
        )}
      >
        {variant === "grouped" && <AgentSetupGrouped />}
        {variant === "tabbed" && <AgentSetupTabbed />}
        {variant === "context-bar" && <AgentSetupMinimal />}
        {variant === "accordion" && <AgentSetupAccordion />}
        {variant === "priority" && <AgentSetupPriority />}
        {variant === "sidebar-tabs" && <AgentSetupOneTimeOnly />}
        {variant === "header-strip" && <AgentSetupOneTimeOnly />}
        {variant === "drawer" && <AgentSetupOneTimeOnly />}
        {variant === "detached" && <AgentSetupOneTimeOnly />}
      </div>
    </div>
  );
}
