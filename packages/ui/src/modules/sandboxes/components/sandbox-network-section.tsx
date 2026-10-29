import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const MOCK_RULES = [
  { host: "api.github.com", action: "allow" as const },
  { host: "registry.npmjs.org", action: "allow" as const },
  { host: "*.internal.corp", action: "deny" as const },
];

export function SandboxNetworkSection(props: {
  agentId: string;
  header: (actions?: ReactNode) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {props.header()}
      <p className="text-sm text-muted-foreground">
        Preset:{" "}
        <span className="font-medium text-foreground">Trusted defaults</span>
      </p>
      <Card className="divide-y divide-border overflow-hidden">
        {MOCK_RULES.map((r) => (
          <div
            key={r.host}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <code className="text-sm text-foreground">{r.host}</code>
            <Badge
              variant={r.action === "allow" ? "default" : "secondary"}
              className="text-xs"
            >
              {r.action}
            </Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}
