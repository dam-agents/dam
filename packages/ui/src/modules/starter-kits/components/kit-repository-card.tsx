import { Branch, Launch } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { externalLinkProps } from "@/lib/external-link";

import { shortKitVersion } from "../lib/setup.js";

export function KitRepositoryCard({
  kit,
}: {
  kit: Pick<StarterKitView, "seed">;
}) {
  const seed = kit.seed;
  if (!seed) return null;
  const name = seed.url.replace("https://github.com/", "");
  const where =
    seed.into === "home" ? "the agent's home directory" : "the work directory";
  return (
    <li
      data-testid="starter-kit-repository"
      className="flex items-center gap-4 rounded-lg border border-kit-line bg-kit-surface px-4 py-3"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-kit-tint text-kit">
        <Branch size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={seed.url}
            {...externalLinkProps}
            className="inline-flex items-center gap-1 text-sm font-semibold text-foreground hover:underline"
          >
            {name}
            <Launch size={12} aria-hidden />
          </a>
          <Badge variant="kit" size="sm">
            Starter kit
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {`${seed.ref ? `On ${seed.ref}` : "Default branch"}${
            seed.commit ? ` at ${shortKitVersion(seed.commit)}` : ""
          }, seeded into ${where} before the first session.`}
        </p>
      </div>
    </li>
  );
}
