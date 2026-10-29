import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import type { AgentView } from "../../../types.js";

const MOCK_EDITORS = ["alice@example.com", "bob@example.com"];

export function PeopleSection({ agent: _agent }: { agent: AgentView }) {
  return (
    <section className="mb-8 flex flex-col gap-4" data-testid="agent-people">
      <div className="flex flex-col gap-2">
        <SectionLabel>Owner</SectionLabel>
        <p className="text-sm text-foreground">you (owner@example.com)</p>
      </div>
      <div className="flex flex-col gap-2">
        <SectionLabel>Editors</SectionLabel>
        <ul className="-ml-1 pr-1" data-testid="agent-editor-list">
          {MOCK_EDITORS.map((email) => (
            <li
              key={email}
              className="flex h-9 items-center justify-between gap-2 rounded-md pl-1"
            >
              <span className="truncate text-sm text-foreground">{email}</span>
            </li>
          ))}
        </ul>
      </div>
      <Callout
        tone="warning"
        size="sm"
        role="note"
        className="text-xs"
        data-testid="agent-editors-warning"
      >
        Editors see this agent&apos;s sessions, connections, and credentials.
        Add only people you trust.
      </Callout>
    </section>
  );
}
