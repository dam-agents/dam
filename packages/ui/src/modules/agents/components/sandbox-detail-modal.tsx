import { Chat, Code, Terminal as CarbonTerminal } from "@carbon/icons-react";
import {
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
} from "api-server-api";
import { ArrowLeft, ExternalLink, Globe, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";

import { CopyableCommand } from "@/components/copyable-command";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";

import { StatusBadge } from "../../../components/status-indicator.js";
import { CLI_REFERENCE_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useArtifacts } from "../../artifacts/api/queries.js";
import { ArtifactKindBadge } from "../../artifacts/components/artifact-badges.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import { useSchedules } from "../../schedules/api/queries.js";
import {
  useHarnessConfigCurrent,
  useHarnessConfigStatus,
} from "../api/harness-config.js";
import { useAgentConnections } from "../api/queries.js";
import { useSkillsState } from "../api/skills.js";

type ModalView = "details" | "terminal" | "ide";

interface Props {
  agent: AgentView;
  onClose: () => void;
  onOpenConfigure: () => void;
}

export function SandboxDetailModal({ agent, onClose, onOpenConfigure }: Props) {
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentTerminal = useStore((s) => s.openAgentTerminal);
  const [view, setView] = useState<ModalView>("details");

  return (
    <Modal widthClass="w-[520px]">
      {view === "details" && (
        <DetailsView
          agent={agent}
          onClose={onClose}
          onOpenConfigure={onOpenConfigure}
          onChat={() => {
            onClose();
            selectAgent(agent.id);
          }}
          onTerminalWeb={() => {
            onClose();
            openAgentTerminal(agent.id);
          }}
          onTerminalLocal={() => setView("terminal")}
          onIde={() => setView("ide")}
        />
      )}
      {view === "terminal" && (
        <TerminalView agent={agent} onBack={() => setView("details")} />
      )}
      {view === "ide" && (
        <IdeView agent={agent} onBack={() => setView("details")} />
      )}
    </Modal>
  );
}

/* ─── Details view (default) ─── */

function DetailsView({
  agent,
  onClose,
  onOpenConfigure,
  onChat,
  onTerminalWeb,
  onTerminalLocal,
  onIde,
}: {
  agent: AgentView;
  onClose: () => void;
  onOpenConfigure: () => void;
  onChat: () => void;
  onTerminalWeb: () => void;
  onTerminalLocal: () => void;
  onIde: () => void;
}) {
  const { data: connectionTemplates = [] } = useConnectionTemplates();
  const connectionsQuery = useAgentConnections(agent.id);
  const { data: schedules = [] } = useSchedules(agent.id);
  const skillsState = useSkillsState(agent.id);
  const { data: artifacts } = useArtifacts({ agentId: agent.id });
  const { data: configStatus } = useHarnessConfigStatus(agent.id);
  const { data: currentConfig } = useHarnessConfigCurrent(agent.id);
  const setView = useStore((s) => s.setView);

  const modelName = useMemo(() => {
    const value = currentConfig?.model;
    if (!value) return null;
    const modelGroup = configStatus?.catalog?.options.find(
      (g: { id: string }) => g.id === "model",
    );
    return (
      modelGroup?.choices.find(
        (c: { value: string; name: string }) => c.value === value,
      )?.name ?? value
    );
  }, [currentConfig?.model, configStatus?.catalog]);

  const { providerConnections, appConnections } = useMemo(() => {
    const granted = connectionsQuery.data;
    if (!granted || !Array.isArray(granted))
      return { providerConnections: [], appConnections: [] };
    const all = granted.map(
      (c: { id: string; templateId: string; name: string }) => {
        const tpl = connectionTemplates.find((t) => t.id === c.templateId);
        return {
          id: c.id,
          name: c.name,
          templateId: c.templateId,
          iconSlug: tpl?.iconSlug,
        };
      },
    );
    return {
      providerConnections: all.filter((c) =>
        PROVIDER_TEMPLATE_IDS.has(c.templateId),
      ),
      appConnections: all.filter(
        (c) => !PROVIDER_TEMPLATE_IDS.has(c.templateId),
      ),
    };
  }, [connectionsQuery.data, connectionTemplates]);

  const skillCount =
    (skillsState.data?.installed.length ?? 0) +
    (skillsState.data?.standalone.length ?? 0);

  const enabledSchedules = schedules.filter((s) => s.enabled).length;
  const latestArtifacts = (artifacts ?? []).slice(0, 3);

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-[18px] font-semibold text-foreground">
              {agent.name}
            </h2>
            <StatusBadge state={agent.state} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onOpenConfigure}>
              <Pencil size={14} />
              Edit
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-5">
        {agent.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-[14px] text-destructive">{agent.error}</p>
          </div>
        )}

        {/* Sandbox Setup */}
        <div className="flex flex-col gap-3">
          <SectionTitle>Sandbox Setup</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <InfoChip label="Size" value={formatSize(agent.size)} />
            <InfoChip
              label="Image"
              value={agent.image.split("/").pop() ?? agent.image}
            />
            <InfoChip label="Model" value={modelName ?? "Default"} />
            <InfoChip
              label="Network access"
              value={
                agent.grantedConnectionIds.length > 0
                  ? "Trusted defaults"
                  : "Strict default-deny"
              }
              icon={<Globe size={14} className="text-muted-foreground" />}
            />
            <InfoChip label="Skills" value={String(skillCount)} />
            <InfoChip label="Schedules" value={String(enabledSchedules)} />
          </div>
        </div>

        {/* Provider */}
        {providerConnections.length > 0 && (
          <div className="flex flex-col gap-3">
            <SectionTitle>Provider</SectionTitle>
            <div className="flex flex-col gap-2">
              {providerConnections.map((conn) => {
                const providerType = providerTypeForTemplateId(conn.templateId);
                return (
                  <div
                    key={conn.id}
                    className="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
                  >
                    {providerType && (
                      <CardIcon provider={providerType} size="sm" />
                    )}
                    <span className="text-[14px] font-medium text-foreground">
                      {conn.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connections */}
        <div className="flex flex-col gap-3">
          <SectionTitle>Connections</SectionTitle>
          {appConnections.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="divide-y divide-border">
                {appConnections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center gap-2.5 px-4 py-3"
                  >
                    <ConnectionIcon
                      iconSlug={conn.iconSlug}
                      alt={conn.name}
                      size={16}
                      className="shrink-0 text-foreground/80"
                    />
                    <span className="text-[14px] text-foreground">
                      {conn.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              No connections added
            </p>
          )}
        </div>

        {/* Artifacts */}
        <div className="flex flex-col gap-3">
          <SectionTitle>Artifacts</SectionTitle>
          {latestArtifacts.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="divide-y divide-border">
                {latestArtifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <ArtifactKindBadge kind={artifact.kind} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                      {artifact.title}
                    </span>
                    {artifact.version > 1 && (
                      <span className="shrink-0 text-[14px] text-muted-foreground">
                        v{artifact.version}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {(artifacts?.length ?? 0) > 3 && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setView("artifacts");
                  }}
                  className="flex w-full items-center justify-center border-t border-border py-2 text-[14px] font-medium text-accent transition-colors hover:bg-muted/60"
                >
                  View all artifacts ({artifacts?.length})
                </button>
              )}
            </div>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              No artifacts yet
            </p>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <div className="grid w-full grid-cols-4 gap-2">
          <Button variant="outline" onClick={onChat}>
            <Chat size={16} />
            Chat
          </Button>
          <Button variant="outline" onClick={onTerminalWeb}>
            <CarbonTerminal size={16} />
            Terminal
          </Button>
          <Button variant="outline" onClick={onTerminalLocal}>
            <CarbonTerminal size={16} />
            Local
          </Button>
          <Button variant="outline" onClick={onIde}>
            <Code size={16} />
            IDE
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/* ─── Terminal (local) view ─── */

function TerminalView({
  agent,
  onBack,
}: {
  agent: AgentView;
  onBack: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-[18px] font-semibold text-foreground">
            Open in Terminal
          </h2>
        </div>
        <p className="mt-2 text-[14px] text-muted-foreground">
          <code className="font-mono">dam chat</code> connects your terminal to{" "}
          <strong className="text-foreground">{agent.name}</strong>&apos;s
          interactive TUI.
        </p>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <span className="text-[14px] font-medium text-foreground">
          Attach to the sandbox
        </span>
        <CopyableCommand command={`dam chat ${agent.id}`} />
        <CliQuickstartNote />
      </DialogBody>
    </>
  );
}

/* ─── IDE view ─── */

function IdeView({ agent, onBack }: { agent: AgentView; onBack: () => void }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-[18px] font-semibold text-foreground">
            Open in IDE
          </h2>
        </div>
        <p className="mt-2 text-[14px] text-muted-foreground">
          <code className="font-mono">dam ssh connect</code> launches your
          editor against{" "}
          <strong className="text-foreground">{agent.name}</strong>&apos;s
          workspace over SSH.
        </p>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <span className="text-[14px] font-medium text-foreground">
          Open in VS Code
        </span>
        <CopyableCommand command={`dam ssh connect -x code ${agent.id}`} />
        <span className="mt-1 text-[14px] font-medium text-foreground">
          Open in Zed
        </span>
        <CopyableCommand command={`dam ssh connect -x zed ${agent.id}`} />
        <CliQuickstartNote />
      </DialogBody>
    </>
  );
}

/* ─── Shared components ─── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] font-medium text-muted-foreground">{children}</p>
  );
}

function InfoChip({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-[14px] text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 truncate text-[14px] font-medium text-foreground">
        {icon}
        {value}
      </span>
    </div>
  );
}

function CliQuickstartNote() {
  return (
    <p className="text-[14px] text-muted-foreground">
      First time? Installing the CLI and logging in is covered in the{" "}
      <a
        href={CLI_REFERENCE_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
      >
        CLI quickstart <ExternalLink size={13} />
      </a>
    </p>
  );
}

function formatSize(size: { cpu?: string; memory?: string }): string {
  const parts: string[] = [];
  if (size.cpu) {
    const milli = parseInt(size.cpu, 10);
    const cores = milli >= 1000 ? milli / 1000 : milli / 1000;
    parts.push(`${cores} cores`);
  }
  if (size.memory) parts.push(size.memory);
  return parts.join(" / ") || "Default";
}
