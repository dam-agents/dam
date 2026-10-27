import { Launch } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

export function KitKnowledgeBaseNote({
  kit,
  className,
}: {
  kit: Pick<StarterKitView, "knowledgeBase" | "seed" | "name">;
  className?: string;
}) {
  if (!kit.knowledgeBase || !kit.seed) return null;
  return (
    <p className={cn("text-muted-foreground", className)}>
      Uses the knowledge base skills from{" "}
      <a
        href={kit.seed.url}
        {...externalLinkProps}
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
      >
        {kit.name}
        <Launch size={12} aria-hidden />
      </a>
      , installed by its own bootstrap.
    </p>
  );
}
