import { Close } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentDisplayName, useAgents } from "../../agents/api/queries.js";
import { SandboxArtifactsSection } from "../../artifacts/components/sandbox-artifacts-section.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";
import { ConnectionsSection } from "./connections-section.js";
import { SandboxChannelsSection } from "./sandbox-channels-section.js";
import { SandboxSchedulesSection } from "./sandbox-schedules-section.js";
import { SandboxSetupSection } from "./sandbox-setup-section.js";
import { SandboxSkillsSection } from "./sandbox-skills-section.js";

const SECTIONS: { section: SandboxSection; title: string }[] = [
  { section: "setup", title: "Agent Setup" },
  { section: "connections", title: "Connections" },
  { section: "channels", title: "Channels" },
  { section: "skills", title: "Skills" },
  { section: "schedules", title: "Schedules" },
  { section: "artifacts", title: "Artifacts" },
  { section: "usage", title: "Usage" },
];

interface Props {
  agentId: string;
  initialSection?: SandboxSection;
  onClose: () => void;
}

export function ConfigureAgentModal({
  agentId,
  initialSection = "schedules",
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

  const f = useSandboxSettingsForm();
  const { data: agentsData } = useAgents();
  const agent = agentsData?.list.find((a) => a.id === agentId) ?? null;
  const agentName = useAgentDisplayName(agentId);
  const { summaries, warnings } = useSectionSummaries(agent);

  const footer =
    section === "setup" && f.status === "ready" && (f.dirty || true) ? (
      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
        {f.wildcardHostInScope && (
          <span
            role="alert"
            className="mr-auto inline-flex items-center gap-1.5 text-xs text-warning"
          >
            <span aria-hidden="true">⚠</span>
            Allow everything is on — narrow with deny rules or remove the
            wildcard.
          </span>
        )}
        <Button onClick={f.onSave} disabled={f.isSubmitDisabled}>
          {f.saving ? "Saving…" : "Submit changes"}
        </Button>
      </div>
    ) : null;

  return (
    <Modal widthClass="w-[960px]">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {agentName ?? "Configure Agent"}
        </h2>
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
          {section === "setup" && f.status === "ready" && (
            <SandboxSetupSection f={f} />
          )}
          {section === "connections" && (
            <ConnectionsSection
              agentId={agentId}
              oauthReturnView={routeToPath({
                view: "sandbox-home",
                agentId,
                sandboxSection: "connections",
              })}
            />
          )}
          {section === "channels" && (
            <SandboxChannelsSection agentId={agentId} />
          )}
          {section === "skills" && agent && (
            <SandboxSkillsSection agent={agent} />
          )}
          {section === "schedules" && (
            <SandboxSchedulesSection agentId={agentId} />
          )}
          {section === "artifacts" && (
            <SandboxArtifactsSection agentId={agentId} />
          )}
          {section === "usage" && <SandboxUsageSection agentId={agentId} />}
        </div>
      </div>

      {footer}
    </Modal>
  );
}
