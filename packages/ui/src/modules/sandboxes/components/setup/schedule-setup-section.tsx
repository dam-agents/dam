import { Time } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

export function ScheduleSetupSection() {
  return (
    <section className="mb-8">
      <SectionLabel spaced>
        Schedule{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </SectionLabel>
      <Callout inset className="bg-card">
        <div className="flex flex-col items-center gap-4 py-6">
          <p className="text-center text-sm text-foreground/80">
            Automate this agent on a recurring schedule,
            <br />
            you can also create schedules by chatting with your agent
          </p>
          <Button variant="outline">
            <Time size={16} />
            Create schedule
          </Button>
        </div>
      </Callout>
    </section>
  );
}
