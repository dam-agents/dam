import type { Brand, SecurityCheckLevel } from "api-server-api";

export interface SecurityCheckLevelOption {
  value: SecurityCheckLevel;
  label: string;
  description: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a person reads before they choose how much
 * their weekly security check does, in a few plain words and none of the
 * platform's own terms. Only the top level runs the person's other agents:
 * that is the one cost a person cannot see from the assistant's own
 * schedule, so its words name it.
 */
export function securityCheckLevelIntro(brand: Brand): string {
  return `Once a week, ${brand.assistantName} looks for security problems in how your agents are set up, and alerts you when it finds one.`;
}

export function securityCheckLevelOptions(
  brand: Brand,
): SecurityCheckLevelOption[] {
  return [
    { value: "off", label: "Off", description: "No weekly check." },
    {
      value: "standard",
      label: "Standard",
      description: `${brand.assistantName} checks on its own. Your other agents do not run.`,
    },
    {
      value: "deep",
      label: "Deep",
      description: `${brand.assistantName} also asks the agents you share with other people about their instructions. Each of them runs once, at its usual cost.`,
    },
  ];
}
