import { z } from "zod";

export interface EnvVar {
  name: string;
  value: string;
}

export enum ChannelType {
  Slack = "slack",
  Telegram = "telegram",
}

/** One rule for every user-named resource: lowercase, digits, single hyphens,
 *  1–63 chars. Shared so two surfaces can never drift on what is legal; each
 *  supplies its own example, since a message naming the wrong kind of thing is
 *  worse than a slightly duplicated sentence. */
export const RESOURCE_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function resourceNameSchema(example: string) {
  return z
    .string()
    .min(1, "name is required")
    .max(63, "name must be 63 characters or fewer")
    .regex(
      RESOURCE_NAME_PATTERN,
      `name must be lowercase letters, digits, and single hyphens (e.g. ${example})`,
    );
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
