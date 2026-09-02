import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

export function SkillsSetupSection() {
  return (
    <section className="mb-8">
      <SectionLabel spaced>
        Skills{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </SectionLabel>
      <Callout inset className="bg-card">
        <div className="flex flex-col items-center gap-4 py-6">
          <p className="text-center text-sm text-foreground/80">
            Give your agent custom skills to extend what it can do,
            <br />
            like searching the web, querying databases, or calling APIs
          </p>
          <Button variant="outline">
            <Add size={16} />
            Add skills
          </Button>
        </div>
      </Callout>
    </section>
  );
}
