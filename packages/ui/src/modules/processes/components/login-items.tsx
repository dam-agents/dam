import type { StartupItem } from "agent-runtime-api";

import { GROUP_HEADING_CLASS, GroupCount } from "./group-heading.js";
import { LoginItemRow } from "./login-item-row.js";

interface Props {
  agentId: string;
  items: readonly StartupItem[];
  openOutputKey: string | null;
  onOpenOutput: (key: string) => void;
}

export function LoginItems({
  agentId,
  items,
  openOutputKey,
  onOpenOutput,
}: Props) {
  if (items.length === 0) return null;
  return (
    <section data-testid="login-items">
      <h3 className={GROUP_HEADING_CLASS}>
        Login items
        <GroupCount count={items.length} />
      </h3>
      <ul>
        {items.map((item) => (
          <LoginItemRow
            key={item.id}
            agentId={agentId}
            item={item}
            openOutputKey={openOutputKey}
            onOpenOutput={onOpenOutput}
          />
        ))}
      </ul>
    </section>
  );
}
