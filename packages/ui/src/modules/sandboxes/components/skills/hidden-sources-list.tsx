import { View } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { repoSlug } from "@/lib/git-source";

export function HiddenSourcesList({
  sources,
  onShow,
}: {
  sources: readonly SkillSource[];
  onShow: (id: string) => Promise<boolean>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (sources.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-5">
      <p className="text-sm font-medium text-foreground">
        Hidden for this agent
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {sources.map((source) => (
          <li key={source.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{source.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {repoSlug(source.gitUrl)}
                {source.path ? ` · ${source.path}` : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyId !== null}
              onClick={async () => {
                setBusyId(source.id);
                try {
                  await onShow(source.id);
                } finally {
                  setBusyId(null);
                }
              }}
            >
              {busyId === source.id ? (
                <Spinner size={14} />
              ) : (
                <View size={14} />
              )}
              Show
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
