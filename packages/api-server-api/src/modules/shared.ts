import { z } from "zod";

export interface EnvVar {
  name: string;
  value: string;
}

export enum ChannelType {
  Slack = "slack",
  Telegram = "telegram",
}

export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidEnvName(name: string): boolean {
  return name.length > 0 && ENV_NAME_RE.test(name);
}

export const envVarSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(ENV_NAME_RE, "name must match [A-Z_][A-Z0-9_]*"),
  value: z.string().max(10000),
});
