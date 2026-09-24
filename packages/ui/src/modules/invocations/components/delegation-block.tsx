import { useMemo, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import type { ToolChip } from "../../../types.js";
import { ActivityBlock } from "../../sessions/components/activity-block.js";
import { ToolContentBlock } from "../../sessions/components/tool-chip.js";
import { useDelegationTree } from "../api/queries.js";
import type { FanOutSpawn } from "../lib/fan-out.js";
import { DelegationShell } from "./delegation-shell.js";

interface Props {
  chip: ToolChip;
  spawns: readonly FanOutSpawn[];
}

export function DelegationBlock({ chip, spawns }: Props) {
  const driverAgentId = useStore((s) => s.selectedAgent);
  const spawnIds = useMemo(() => spawns.map((s) => s.id), [spawns]);
  const { data: tree, isPending } = useDelegationTree(driverAgentId, spawnIds);
  const nodes = useMemo(() => tree?.nodes ?? [], [tree]);

  return (
    <DelegationShell
      verb="Delegated to"
      nodes={driverAgentId ? nodes : []}
      driverAgentId={driverAgentId ?? ""}
      fallback={spawns.map((spawn) => (
        <PendingRow key={spawn.id} label={spawn.label} loading={isPending} />
      ))}
      footer={<ScriptFold chip={chip} />}
    />
  );
}

function ScriptFold({ chip }: { chip: ToolChip }) {
  const [open, setOpen] = useState(false);
  return (
    <ActivityBlock
      open={open}
      onToggle={() => setOpen((o) => !o)}
      className="mt-2 border-l-0 pl-0 text-[11px]"
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
