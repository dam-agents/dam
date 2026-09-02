import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { SectionLabel } from "@/components/ui/section-label";

export function ScheduleSetupSection() {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Schedules</SectionLabel>
      <EmptyStateCard
        message="You have not set up any Schedules yet"
        actionLabel="Create Schedule"
        onAction={() => {}}
      />
    </section>
  );
}
