import { Branch, Close, Launch, Undo } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { kitSeedRemovable, shortKitVersion } from "../lib/setup.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The kit's own repository on the setup page, as
 * a kit card like its schedules: what it is, the branch it stays on, the
 * commit the catalog pinned, and where it lands. The cross removes it, so the
 * agent starts as if the kit shipped none — offered only when nothing in the
 * kit runs from that checkout.
 */
export function KitRepositoryCard({
  kit,
  skipped,
  onToggleSkipped,
}: {
  kit: Pick<StarterKitView, "seed" | "install">;
  skipped: boolean;
  onToggleSkipped: () => void;
}) {
  const seed = kit.seed;
  if (!seed) return null;
  const name = seed.url.replace("https://github.com/", "");
  const removable = kitSeedRemovable(kit);
  const where =
    seed.into === "home" ? "the agent's home directory" : "the work directory";
  return (
    <li
      data-testid="starter-kit-repository"
      className={cn(
        "flex items-center gap-4 rounded-lg border px-4 py-3",
        skipped
          ? "border-border bg-muted/30 opacity-70"
          : "border-kit-line bg-kit-surface",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          skipped ? "bg-muted text-muted-foreground" : "bg-kit-tint text-kit",
        )}
      >
        <Branch size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={seed.url}
            {...externalLinkProps}
            className={cn(
              "inline-flex items-center gap-1 text-sm font-semibold hover:underline",
              skipped
                ? "text-muted-foreground line-through"
                : "text-foreground",
            )}
          >
            {name}
            <Launch size={12} aria-hidden />
          </a>
          <Badge variant="kit" size="sm">
            Starter Kit
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {skipped
            ? "Removed — the agent starts without the kit's repository."
            : `${seed.ref ? `On ${seed.ref}` : "Default branch"}${
                seed.commit ? ` at ${shortKitVersion(seed.commit)}` : ""
              }, seeded into ${where} before the first session.`}
        </p>
      </div>
      {removable && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={skipped ? `Add back ${name}` : `Remove ${name}`}
          title={skipped ? "Add back" : "Remove the kit's repository"}
          onClick={onToggleSkipped}
        >
          {skipped ? <Undo size={16} /> : <Close size={16} />}
        </Button>
      )}
    </li>
  );
}
