import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { SectionLabel } from "@/components/ui/section-label";

export function SkillsSetupSection() {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Skills</SectionLabel>
      <EmptyStateCard
        message="You have not added any Skill Sources to this Agent yet"
        actionLabel="Add Skill Source"
        onAction={() => {}}
      />
    </section>
  );
}
