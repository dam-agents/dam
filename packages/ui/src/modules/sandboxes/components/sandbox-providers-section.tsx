import { Settings } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import { useStore } from "../../../store.js";

const MOCK_PROVIDERS = [
  { id: "p1", name: "Anthropic", type: "anthropic", attached: true },
  { id: "p2", name: "OpenAI", type: "openai", attached: false },
];

export function SandboxProvidersSection({
  agentId: _agentId,
  header,
}: {
  agentId: string;
  header: (actions?: ReactNode) => ReactNode;
}) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);

  return (
    <div className="flex flex-col gap-3">
      {header()}
      <Card className="divide-y divide-border overflow-hidden">
        {MOCK_PROVIDERS.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex size-6 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">
              {p.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">
                {p.name}
              </span>
            </div>
            <Switch
              checked={p.attached}
              label={`Use ${p.name} in this agent`}
              onCheckedChange={() => {}}
            />
          </div>
        ))}
      </Card>
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => navigateToSettings("providers")}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <Settings size={16} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Manage providers
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Connect another LLM provider to give this agent more models.
            </p>
          </div>
        </button>
      </Card>
    </div>
  );
}
