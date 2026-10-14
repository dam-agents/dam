import type { ProcessList as ProcessListData } from "agent-runtime-api";
import type { CSSProperties, Ref } from "react";

import { type AgentReach, useAgentReach } from "../../agents/api/queries.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useProcesses } from "../api/queries.js";
import { PROCESSES_SECTION_ID } from "../hooks/use-open-processes-section.js";
import { ProcessList } from "./process-list.js";

interface Props {
  agentId: string | null;
  alwaysOn: boolean;
  open: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
}

export function ProcessesPanel({
  agentId,
  alwaysOn,
  open,
  onToggle,
  className,
  style,
  ref,
}: Props) {
  const reach = useAgentReach(agentId);
  const { data, isPending, isError } = useProcesses(agentId, {
    enabled: true,
    poll: open,
  });

  return (
    <SidebarSection
      id={PROCESSES_SECTION_ID}
      title="Processes"
      open={open}
      onToggle={onToggle}
      className={className}
      headerClassName="border-t border-border"
      style={style}
      ref={ref}
    >
      {open && (
        <ProcessesSectionBody
          agentId={agentId}
          reach={reach}
          data={data}
          isPending={isPending}
          isError={isError}
          alwaysOn={alwaysOn}
        />
      )}
    </SidebarSection>
  );
}

function ProcessesSectionBody({
  agentId,
  reach,
  data,
  isPending,
  isError,
  alwaysOn,
}: {
  agentId: string | null;
  reach: AgentReach;
  data: ProcessListData | undefined;
  isPending: boolean;
  isError: boolean;
  alwaysOn: boolean;
}) {
  if (reach === "inoperable")
    return <PanelNotice text="Processes show once the agent is running." />;
  if (data && agentId)
    return (
      <>
        {reach === "unreachable" && (
          <PanelNotice text="Can't reach the agent right now. This list may be out of date." />
        )}
        <ProcessList agentId={agentId} list={data} alwaysOn={alwaysOn} />
      </>
    );
  if (reach === "unreachable")
    return <PanelNotice text="Can't reach the agent right now." />;
  if (isError)
    return <PanelNotice text="Couldn't load the agent's processes." />;
  if (isPending) return <PanelNotice text="Loading…" />;
  return null;
}

function PanelNotice({ text }: { text: string }) {
  return <p className="px-4 py-5 text-xs text-muted-foreground">{text}</p>;
}
