import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

const MOCK_ENVIRONMENTS = [
  {
    id: "env-1",
    name: "csv-export-preview",
    status: "running" as const,
    url: "https://env-abc123.example.dev",
    expiresIn: "3 days",
  },
  {
    id: "env-2",
    name: "pr-147-build",
    status: "expired" as const,
    url: "https://env-def456.example.dev",
    expiresIn: "Expired",
  },
];

const STATUS_COLORS: Record<string, string> = {
  running: "bg-[#24a148] dark:bg-[#42be65]",
  starting: "bg-warning",
  expired: "bg-muted-foreground",
  deleted: "bg-destructive",
};

export function SandboxEnvironmentsSection(props: {
  agentId: string;
  header: (actions?: ReactNode) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {props.header()}
      <div className="flex flex-col gap-2">
        <SectionLabel>Who may open them</SectionLabel>
        <p className="text-sm text-muted-foreground">
          You always may. Add the people who review this agent&apos;s work.
        </p>
      </div>
      <Card className="divide-y divide-border overflow-hidden">
        {MOCK_ENVIRONMENTS.map((env) => (
          <div key={env.id} className="flex items-center gap-3 px-4 py-3">
            <span
              className={`size-2 shrink-0 rounded-full ${STATUS_COLORS[env.status] ?? "bg-muted-foreground"}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {env.name}
              </p>
              <p className="text-xs text-muted-foreground">{env.expiresIn}</p>
            </div>
            <Badge variant="secondary" className="text-xs">
              {env.status}
            </Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}
