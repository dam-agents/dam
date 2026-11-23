import type { Brand, SecurityCheckLevel } from "api-server-api";

export interface SecurityCheckLevelOption {
  value: SecurityCheckLevel;
  label: string;
  description: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a person reads before they choose how much
 * their weekly security check does. Every level reads the instructions of
 * the agents they share, which wakes those agents and calls no model, and
 * only the top one runs turns on them: that is the one cost a person cannot
 * see from the assistant's own schedule, so the words name it.
 */
export function securityCheckLevelIntro(brand: Brand): string {
  return `${brand.assistantName} checks your setup once a week against the security advisory, and alerts you when something puts your accounts at risk. Each check also reads the instructions of the agents you share with other people, which wakes them and calls no model. Choose how much a check does. Only Deep runs a turn on your other agents.`;
}

export function securityCheckLevelOptions(
  brand: Brand,
): SecurityCheckLevelOption[] {
  const run = (effort: string): string =>
    `One run of ${brand.assistantName} a week, at ${effort} effort.`;
  return [
    { value: "off", label: "Off", description: "No check runs." },
    { value: "low", label: "Low", description: run("low") },
    { value: "medium", label: "Medium", description: run("medium") },
    { value: "high", label: "High", description: run("high") },
    {
      value: "deep",
      label: "Deep",
      description: `The High check, and ${brand.assistantName} also asks each agent you share with other people what its files left open. Each question runs one turn on that agent, which costs what any turn on that agent costs.`,
    },
  ];
}
