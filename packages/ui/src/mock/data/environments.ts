import type { EnvironmentStatus } from "../../types.js";
import { AGENT_IDS } from "./agents.js";

export interface MockEnvironment {
  id: string;
  name: string;
  status: EnvironmentStatus;
  url: string;
  expiresAt: string;
  accessLabel: string;
}

const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

export const environmentsByAgent: Record<string, MockEnvironment[]> = {
  [AGENT_IDS.codexResearch]: [
    {
      id: "env-csv-export-1",
      name: "csv-export-preview",
      status: "running",
      url: "https://csv-export-preview.envs.example.com",
      expiresAt: threeDays,
      accessLabel: "Your team",
    },
  ],
};
