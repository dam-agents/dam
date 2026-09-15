import { Launch } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { kbTemplate } from "../../knowledge-bases/lib/kb-templates.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where a knowledge base kit's tooling comes from.
 * Its skills are installed by the template's own bootstrap, not by the
 * platform, so they appear in no Skills list — without this line the kit reads
 * as bringing nothing.
 */
export function KitKnowledgeBaseNote({
  kit,
  className,
}: {
  kit: Pick<StarterKitView, "knowledgeBase">;
  className?: string;
}) {
  const template = kit.knowledgeBase
    ? kbTemplate(kit.knowledgeBase.template)
    : undefined;
  if (!template) return null;
  return (
    <p className={cn("text-muted-foreground", className)}>
      Uses the{" "}
      <a
        href={template.repoUrl}
        {...externalLinkProps}
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
      >
        {template.name}
        <Launch size={12} aria-hidden />
      </a>{" "}
      knowledge base skills.
    </p>
  );
}
