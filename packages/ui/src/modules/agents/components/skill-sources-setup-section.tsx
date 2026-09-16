import { Add } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast.js";
import { AddSkillSourceModal } from "../../sandboxes/components/skills/add-skill-source-modal.js";

function repoSlug(gitUrl: string): string {
  return gitUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Adding skill sources while creating an agent. A
 * skill source belongs to the owner, not to an agent, so it can be created
 * before the agent exists; the new agent's Skills panel then offers it like
 * any other. Uploading local skill files needs an agent to land in, so that
 * tab says so instead of pretending.
 */
export function SkillSourcesSetupSection({
  standalone,
}: {
  standalone: boolean;
}) {
  const [added, setAdded] = useState<SkillSource[]>([]);
  const [open, setOpen] = useState(false);

  const list = added.length > 0 && (
    <ul className={cn(FIELD_INSET, "mb-3 flex flex-col gap-2")}>
      {added.map((source) => (
        <li
          key={source.id}
          className="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {source.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {repoSlug(source.gitUrl)}
              {source.path ? ` · ${source.path}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );

  const button = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      data-testid="setup-add-skill-source"
    >
      <Add size={16} /> Add skill source
    </Button>
  );

  return (
    <>
      {standalone ? (
        <section className="mb-8">
          <SectionLabel spaced>
            Skills <span className="font-normal">(optional)</span>
          </SectionLabel>
          {list}
          <div className={FIELD_INSET}>{button}</div>
        </section>
      ) : (
        <div className={cn(FIELD_INSET, "mt-3")}>
          {list}
          {button}
        </div>
      )}
      {open && (
        <AddSkillSourceModal
          sources={added}
          onClose={() => setOpen(false)}
          onCreate={async (input) => {
            try {
              const source = await api.skills.sources.create.mutate({
                name: input.name.trim(),
                gitUrl: input.gitUrl.trim(),
                path: input.path?.trim() || undefined,
              });
              setAdded((prev) => [...prev, source]);
              return source;
            } catch (err) {
              emitToast({
                kind: "error",
                message: `Failed to add source: ${err instanceof Error ? err.message : String(err)}`,
              });
              return null;
            }
          }}
          onCreateSkills={async () => ({
            ok: false as const,
            conflictNames: [],
            message:
              "Local skill files can be uploaded from the agent's Skills panel once it exists.",
          })}
        />
      )}
    </>
  );
}
