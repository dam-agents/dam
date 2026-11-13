import type { CSSProperties, Ref } from "react";

import { processList } from "../../../mock/data/processes.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
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
  const data = processList;

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
      {open &&
        (agentId && data ? (
          <ProcessList agentId={agentId} list={data} alwaysOn={alwaysOn} />
        ) : (
          <PanelNotice text="Processes show once the agent is running." />
        ))}
    </SidebarSection>
  );
}

function PanelNotice({ text }: { text: string }) {
  return <p className="px-4 py-5 text-xs text-muted-foreground">{text}</p>;
}
