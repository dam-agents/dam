import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

interface Props {
  noun: string;
  childConnections: readonly {
    name: string;
    agents: readonly string[] | null;
  }[];
}

function holdersLine(agents: readonly string[] | null): string {
  if (agents === null) return "couldn’t read which agents hold it";
  return agents.length > 0
    ? `held by ${agents.join(", ")}`
    : "held by no agent";
}

export function ParentDeleteImpact({ noun, childConnections }: Props) {
  if (childConnections.length === 0)
    return (
      <p>
        This {noun} will be deleted. No connection is made from it, so no agent
        loses access.
      </p>
    );
  return (
    <>
      <p>
        This {noun} will be deleted, together with every connection made from
        it. The agents that hold those connections all lose access.
      </p>
      <Callout tone="muted" className="mt-4">
        <SectionLabel>Connections deleted with it</SectionLabel>
        <ul
          className="mt-2 flex flex-col gap-1.5 text-sm text-foreground/90"
          data-testid="parent-delete-children"
        >
          {childConnections.map((child) => (
            <li key={child.name}>
              <span className="font-medium">{child.name}</span>
              <span className="text-muted-foreground">
                {" — "}
                {holdersLine(child.agents)}
              </span>
            </li>
          ))}
        </ul>
      </Callout>
    </>
  );
}
