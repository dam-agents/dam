import { Close } from "@carbon/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentDisplayName, useAgents } from "../../agents/api/queries.js";
import {
  AgentAvatar,
  CharAvatar,
  CHAR_NAMES,
  type CharName,
} from "../../agents/components/char-avatar.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { SandboxArtifactsSection } from "../../artifacts/components/sandbox-artifacts-section.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";
import { AgentModelSettingsSection } from "./agent-config-sections.js";
import { AgentManagementActions } from "./agent-management-actions.js";
import { AgentUsageActions } from "./agent-usage-actions.js";
import { ConnectionsSection } from "./connections-section.js";
import { PeopleSection } from "./people-section.js";
import { SandboxBrowserSection } from "./sandbox-browser-section.js";
import { SandboxChannelsSection } from "./sandbox-channels-section.js";
import { SandboxChatFormsSection } from "./sandbox-chat-forms-section.js";
import { SandboxEnvSection } from "./sandbox-env-section.js";
import { SandboxEnvironmentsSection } from "./sandbox-environments-section.js";
import { SandboxNetworkSection } from "./sandbox-network-section.js";
import { SandboxProvidersSection } from "./sandbox-providers-section.js";
import { SandboxSchedulesSection } from "./sandbox-schedules-section.js";
import { SECTIONS } from "./sandbox-section-nav.js";
import { SandboxSkillsSection } from "./sandbox-skills-section.js";

type SectionHeaderSlot = (actions?: ReactNode) => ReactNode;

function makeSectionHeader(
  title: string,
  description?: string,
): SectionHeaderSlot {
  return (actions) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {actions}
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

const SECTIONS_WITH_ACTIONS: ReadonlySet<SandboxSection> = new Set([
  "providers",
  "connections",
  "network",
  "browser",
  "environment",
  "schedules",
  "environments",
]);

interface Props {
  agentId: string;
  initialSection?: SandboxSection;
  onClose: () => void;
}

export function ConfigureAgentModal({
  agentId,
  initialSection = "setup",
  onClose,
}: Props) {
  const [section, setSection] = useState<SandboxSection>(initialSection);
  const prevAgentId = useRef(useStore.getState().agentId);

  useEffect(() => {
    prevAgentId.current = useStore.getState().agentId;
    useStore.setState({ agentId });
    return () => {
      useStore.setState({ agentId: prevAgentId.current });
    };
  }, [agentId]);

  const { data: agentsData } = useAgents();
  const agent = agentsData?.list.find((a) => a.id === agentId) ?? null;
  const agentName = useAgentDisplayName(agentId);
  const display = useResolvedAgentDisplay(agent);
  const { summaries, warnings } = useSectionSummaries(agent);

  const sectionEntry = SECTIONS.find((e) => e.section === section);
  const header = makeSectionHeader(
    sectionEntry?.title ?? "",
    sectionEntry?.description,
  );

  return (
    <Modal widthClass="w-[960px]">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          {agent && display ? (
            <AvatarPicker agentId={agentId} state={display.state} />
          ) : null}
          <h2 className="text-sm font-semibold text-foreground">
            {agentName ?? "Configure Agent"}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1 shrink-0 text-muted-foreground"
        >
          <Close size={16} />
        </Button>
      </div>

      <div className="flex min-h-0" style={{ height: "min(70vh, 640px)" }}>
        <nav
          aria-label="Agent sections"
          className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3"
        >
          {SECTIONS.map((entry) => (
            <button
              key={entry.section}
              type="button"
              onClick={() => setSection(entry.section)}
              data-pointer-target={`configure:${entry.section}`}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                entry.section === section ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {entry.title}
                {warnings?.[entry.section] && (
                  <span
                    aria-hidden
                    title={warnings[entry.section]}
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                  />
                )}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {summaries?.[entry.section] ?? "—"}
              </span>
            </button>
          ))}
        </nav>

        <div
          data-modal-content
          className="min-w-0 flex-1 overflow-y-auto px-8 py-5"
        >
          <style>{`
            [data-modal-content] .md\\:-ml-4 {
              margin-left: 0 !important;
              margin-inline-start: 0 !important;
            }
          `}</style>
          {!SECTIONS_WITH_ACTIONS.has(section) && header()}
          {section === "setup" ? (
            <>
              {agent && <AgentUsageActions agent={agent} />}
              <AgentModelSettingsSection agentId={agentId} />
              <SandboxProvidersSection agentId={agentId} header={header} />
              {agent && display && (
                <AgentManagementActions agent={agent} display={display} />
              )}
            </>
          ) : section === "people" ? (
            agent && <PeopleSection agent={agent} />
          ) : section === "providers" ? (
            <SandboxProvidersSection agentId={agentId} header={header} />
          ) : section === "network" ? (
            <SandboxNetworkSection agentId={agentId} header={header} />
          ) : section === "browser" ? (
            <SandboxBrowserSection agentId={agentId} header={header} />
          ) : section === "environment" ? (
            <SandboxEnvSection agentId={agentId} header={header} />
          ) : section === "channels" ? (
            <SandboxChannelsSection agentId={agentId} />
          ) : section === "chat-forms" ? (
            <SandboxChatFormsSection agentId={agentId} />
          ) : section === "skills" ? (
            agent && <SandboxSkillsSection agent={agent} />
          ) : section === "schedules" ? (
            <SandboxSchedulesSection agentId={agentId} />
          ) : section === "artifacts" ? (
            <SandboxArtifactsSection agentId={agentId} />
          ) : section === "environments" ? (
            <SandboxEnvironmentsSection agentId={agentId} header={header} />
          ) : section === "usage" ? (
            <SandboxUsageSection agentId={agentId} />
          ) : (
            <ConnectionsSection
              agentId={agentId}
              oauthReturnView={routeToPath({
                view: "sandbox-home",
                agentId,
                sandboxSection: "connections",
              })}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

function AvatarPicker({
  agentId,
  state,
}: {
  agentId: string;
  state: import("../../agents/utils/agent-resolver.js").AgentDisplayState;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CharName | null>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group relative rounded-lg transition-colors hover:bg-muted"
          aria-label="Change agent icon"
        >
          {selected ? (
            <CharAvatar name={selected} state="running" className="size-7" />
          ) : (
            <AgentAvatar agentId={agentId} state={state} className="size-7" />
          )}
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M12.1 3.9l-.7-.8c-.4-.4-1-.4-1.4 0L4 9.1l-.5 2.9 2.9-.5 6-6c.3-.4.3-1-.3-1.6zM5.6 10.6l-.8.1.1-.8 4.8-4.8.7.7-4.8 4.8z" />
            </svg>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-auto p-3"
      >
        <p className="mb-2 text-sm font-medium text-foreground">
          Choose icon
        </p>
        <div className="grid grid-cols-4 gap-2">
          {CHAR_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setSelected(name);
                setOpen(false);
              }}
              className={cn(
                "rounded-lg p-1.5 transition-colors hover:bg-muted",
                selected === name && "bg-muted ring-2 ring-accent",
              )}
              aria-label={name}
            >
              <CharAvatar name={name} state="running" className="size-8" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
