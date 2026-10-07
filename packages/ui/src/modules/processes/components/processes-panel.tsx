import type { ProcessList as ProcessListData } from "agent-runtime-api";
import type { CSSProperties, Ref } from "react";

import { useStore } from "../../../store.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useProcesses } from "../api/queries.js";
import { useProcessesWatch } from "../hooks/use-processes-watch.js";
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
  const operable = useIsAgentOperable(agentId);
  const outputOpen = useStore((s) => s.openProcessOutputKey !== null);
  const live = open || outputOpen;
  const { data, isPending, isError } = useProcesses(agentId, {
    enabled: live,
    poll: open,
  });
  useProcessesWatch(agentId, live && data !== undefined);

  return (
    <SidebarSection
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
          operable={operable}
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
  operable,
  data,
  isPending,
  isError,
  alwaysOn,
}: {
  operable: boolean;
  data: ProcessListData | undefined;
  isPending: boolean;
  isError: boolean;
  alwaysOn: boolean;
}) {
  if (!operable)
    return <PanelNotice text="Processes show once the agent is running." />;
  if (data) return <ProcessList list={data} alwaysOn={alwaysOn} />;
  if (isError)
    return <PanelNotice text="Couldn't read the agent's processes." />;
  if (isPending) return <PanelNotice text="Loading…" />;
  return null;
}

function PanelNotice({ text }: { text: string }) {
  return <p className="px-4 py-5 text-xs text-muted-foreground">{text}</p>;
}
