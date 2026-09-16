import { Launch } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { shortKitVersion } from "../lib/setup.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the platform seeds into the new agent before
 * its first session, and where: the kit's definition repository, the branch
 * it stays on, the commit the catalog pinned, and whether it becomes the work
 * directory or the agent's home. Without this line the setup page shows an
 * agent that appears to start empty.
 */
export function KitSeedNote({
  kit,
  className,
}: {
  kit: Pick<StarterKitView, "seed">;
  className?: string;
}) {
  const seed = kit.seed;
  if (!seed) return null;
  const where =
    seed.into === "home" ? "the agent's home directory" : "the work directory";
  return (
    <p className={cn("text-muted-foreground", className)}>
      Seeds{" "}
      <a
        href={seed.url}
        {...externalLinkProps}
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
      >
        {seed.url.replace("https://github.com/", "")}
        <Launch size={12} aria-hidden />
      </a>
      {seed.ref ? ` on ${seed.ref}` : ""}
      {seed.commit ? ` at ${shortKitVersion(seed.commit)}` : ""} into {where}{" "}
      before the first session.
    </p>
  );
}
