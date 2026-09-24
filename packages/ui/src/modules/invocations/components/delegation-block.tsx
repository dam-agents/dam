import { Bot } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { ToolChip } from "../../../types.js";
import { ActivityBlock } from "../../sessions/components/activity-block.js";
import { ToolContentBlock } from "../../sessions/components/tool-chip.js";
import { useDelegationTree } from "../api/queries.js";
import { countByStatus, flattenIds } from "../lib/delegation-state.js";
import type { FanOutSpawn } from "../lib/fan-out.js";
import { DelegationCards } from "./delegation-cards.js";

interface Props {
  chip: ToolChip;
  spawns: readonly FanOutSpawn[];
}

export function DelegationBlock({ chip, spawns }: Props) {
  const [open, setOpen] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(false);
  const driverAgentId = useStore((s) => s.selectedAgent);

  const spawnIds = useMemo(() => spawns.map((s) => s.id), [spawns]);
  const { data: tree, isPending } = useDelegationTree(driverAgentId, spawnIds);
  const nodes = useMemo(() => tree?.nodes ?? [], [tree]);
  const total = nodes.length > 0 ? flattenIds(nodes).length : spawns.length;
  const counts = countByStatus(nodes);

  return (
    <ActivityBlock
      open={open}
      onToggle={() => setOpen((o) => !o)}
      label={
        <DelegationHeader
          text={`Delegated to ${total} temporary agent${total === 1 ? "" : "s"}`}
          working={counts.running}
          failed={counts.failed}
        />
      }
    >
      {driverAgentId && nodes.length > 0 ? (
        <DelegationCards nodes={nodes} driverAgentId={driverAgentId} />
      ) : (
        spawns.map((spawn) => (
          <PendingRow key={spawn.id} label={spawn.label} loading={isPending} />
        ))
      )}
      <ActivityBlock
        open={scriptOpen}
        onToggle={() => setScriptOpen((o) => !o)}
        className={cn("mt-2 border-l-0 pl-0 text-[11px]")}
        label={
          <span className="truncate">
            Script <span className="font-mono">· {chip.title}</span>
          </span>
        }
      >
        {chip.content?.map((c, i) =>
          c.text ? <ToolContentBlock key={i} text={c.text} /> : null,
        )}
      </ActivityBlock>
    </ActivityBlock>
  );
}

export function DelegationHeader({
  text,
  working,
  failed,
}: {
  text: string;
  working: number;
  failed: number;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <Bot size={14} className="shrink-0 text-accent" aria-hidden />
      <span className="truncate">{text}</span>
      {working > 0 && (
        <span className="shrink-0 text-[11px]">{working} working</span>
      )}
      {failed > 0 && (
        <span className="shrink-0 text-[11px] text-danger">
          {failed} failed
        </span>
      )}
    </span>
  );
}

function PendingRow({ label, loading }: { label: string; loading: boolean }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      {loading && <Spinner size={12} />}
      <span className="truncate">{label}</span>
      {!loading && <span>no record</span>}
    </div>
  );
}
