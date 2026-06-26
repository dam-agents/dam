import type { ExperimentConfig } from "api-server-api";

export function buildTrialPrompt(input: {
  goal: string;
  spec: ExperimentConfig;
  armSpec: ExperimentConfig;
}): string {
  const parts = [input.goal.trim()];
  if (Object.keys(input.spec).length > 0) {
    parts.push(
      `Shared experiment spec:\n${JSON.stringify(input.spec, null, 2)}`,
    );
  }
  if (Object.keys(input.armSpec).length > 0) {
    parts.push(
      `Your arm configuration:\n${JSON.stringify(input.armSpec, null, 2)}`,
    );
  }
  return parts.join("\n\n");
}
