import { Launch } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { FormError } from "@/components/form-error";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { shortKitVersion } from "../../starter-kits/lib/setup.js";

type KitSeed = NonNullable<StarterKitView["seed"]>;

export interface RepositoryField {
  url: string;
  branch: string;
  error?: string;
  onUrlChange: (url: string) => void;
  onBranchChange: (branch: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The repositories the platform seeds into the new
 * agent before its first session. A kit's own is fixed by the kit, the way
 * the harness is fixed when a kit brings an image — URL, the branch it stays
 * on, the commit the catalog pinned, and whether it becomes the work
 * directory or the agent's home. The user names the one that goes to the
 * work directory (URL and, if they want, a branch) whenever that directory
 * is free; left blank, the agent starts with an empty workspace.
 */
export function RepositorySection({
  fixed,
  field,
}: {
  fixed?: KitSeed;
  field?: RepositoryField;
}) {
  if (!fixed && !field) return null;
  return (
    <section className="mb-8">
      <SectionLabel spaced>Repository</SectionLabel>
      {fixed && <FixedRepository seed={fixed} />}
      {field && (
        <div className={cn(fixed && "mt-3")}>
          <div
            className={cn(
              FIELD_INSET,
              "grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]",
            )}
          >
            <Input
              aria-label="Repository URL"
              value={field.url}
              onChange={(event) => field.onUrlChange(event.target.value)}
              placeholder="https://github.com/org/repo"
            />
            <Input
              aria-label="Branch"
              value={field.branch}
              onChange={(event) => field.onBranchChange(event.target.value)}
              placeholder="default branch"
            />
          </div>
          <p className={cn(FIELD_INSET, "mt-3 text-sm text-muted-foreground")}>
            Seeded into the work directory before the first session. Leave it
            empty to start with an empty workspace.
          </p>
          <FormError message={field.error} />
        </div>
      )}
    </section>
  );
}

function FixedRepository({ seed }: { seed: KitSeed }) {
  const where =
    seed.into === "home" ? "the agent's home directory" : "the work directory";
  return (
    <Callout tone="default" inset>
      <div>
        <a
          href={seed.url}
          {...externalLinkProps}
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
        >
          {seed.url.replace("https://github.com/", "")}
          <Launch size={12} aria-hidden />
        </a>
        {seed.ref ? ` on ${seed.ref}` : ""}
        {seed.commit ? ` at ${shortKitVersion(seed.commit)}` : ""}. Fixed by the
        kit.
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Seeded into {where} before the first session.
      </div>
    </Callout>
  );
}
