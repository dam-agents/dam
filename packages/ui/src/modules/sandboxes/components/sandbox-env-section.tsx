import { Add } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const MOCK_VARS = [
  { name: "NODE_ENV", value: "production" },
  { name: "LOG_LEVEL", value: "info" },
  { name: "CONCURRENCY", value: "4" },
];

export function SandboxEnvSection(props: {
  agentId: string;
  header: (actions?: ReactNode) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {props.header(
        <Button variant="ghost" size="sm">
          <Add size={16} /> Add variable
        </Button>,
      )}
      <Card className="divide-y divide-border overflow-hidden">
        {MOCK_VARS.map((v) => (
          <div
            key={v.name}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <code className="text-sm font-medium text-foreground">
              {v.name}
            </code>
            <span className="text-sm text-muted-foreground">{v.value}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
