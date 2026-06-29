import type { ExperimentConfig } from "api-server-api";

export function buildTrialPrompt(input: {
  prompt: string;
  armSpec: ExperimentConfig;
}): string {
  const parts = [input.prompt.trim()];
  if (Object.keys(input.armSpec).length > 0) {
    parts.push(
      `Your arm configuration:\n${JSON.stringify(input.armSpec, null, 2)}`,
    );
  }
  return parts.join("\n\n");
}
