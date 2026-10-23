import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agents a destructive change takes something from, listed inside the confirm that asks for it. One list, so every confirm that can cost an agent something names those agents in the same place and the same words.
 */
export function AffectedAgents({ names }: { names: readonly string[] }) {
  return (
    <Callout tone="muted" className="mt-4">
      <SectionLabel>Affected agents</SectionLabel>
      <ul className="mt-2 list-disc pl-5 text-sm text-foreground/90">
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </Callout>
  );
}
