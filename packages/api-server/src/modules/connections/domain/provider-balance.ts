import { z } from "zod";
import {
  CURVE_BENDER_HOST,
  IBM_LITELLM_HOST,
  type Connection,
  type ProviderBalance,
} from "api-server-api";

export interface BobTeamPins {
  instanceId?: string;
  teamId?: string;
}

export type BalanceQuery =
  { kind: "bob"; pins: BobTeamPins } | { kind: "litellm"; host: string };

export interface ProviderBalanceSource {
  lookup(
    query: BalanceQuery,
    credential: string,
  ): Promise<ProviderBalance | null>;
}

const nullableNumber = z.number().nullish();

export const bobProfileSchema = z.object({
  instances: z
    .array(
      z.object({
        instance_id: z.string().optional(),
        refresh_at: nullableNumber,
        teams: z
          .array(
            z.object({
              id: z.string().optional(),
              budget_limit: nullableNumber,
              usage: nullableNumber,
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export const liteLlmKeyInfoSchema = z.object({
  info: z.object({
    spend: nullableNumber,
    max_budget: nullableNumber,
    budget_reset_at: z.string().nullish(),
  }),
});

export type BobProfile = z.infer<typeof bobProfileSchema>;
export type LiteLlmKeyInfo = z.infer<typeof liteLlmKeyInfoSchema>;

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function envPin(conn: Connection, name: string): string | undefined {
  for (const c of conn.contributions) {
    if (c.kind === "env" && c.name === name) return c.placeholder;
  }
  return undefined;
}

export function balanceQueryFor(conn: Connection): BalanceQuery | null {
  switch (conn.templateId) {
    case "bob":
      return {
        kind: "bob",
        pins: {
          instanceId: envPin(conn, "BOB_INSTANCE_ID"),
          teamId: envPin(conn, "BOB_TEAM_ID"),
        },
      };
    case "ibm-litellm":
      return { kind: "litellm", host: IBM_LITELLM_HOST };
    case "curve-bender":
      return { kind: "litellm", host: CURVE_BENDER_HOST };
    default:
      return null;
  }
}

export function bobBalance(
  profile: BobProfile,
  pins: BobTeamPins,
): ProviderBalance | null {
  for (const instance of profile.instances ?? []) {
    if (pins.instanceId && instance.instance_id !== pins.instanceId) continue;
    const team = (instance.teams ?? []).find(
      (t) => !pins.teamId || t.id === pins.teamId,
    );
    if (!team) continue;
    return {
      unit: "bobcoins",
      used: team.usage ?? 0,
      limit: team.budget_limit ?? null,
      resetsAt: instance.refresh_at
        ? new Date(instance.refresh_at * 1000).toISOString()
        : null,
    };
  }
  return null;
}

export function liteLlmBalance(key: LiteLlmKeyInfo): ProviderBalance {
  return {
    unit: "usd",
    used: key.info.spend ?? 0,
    limit: key.info.max_budget ?? null,
    resetsAt: isoOrNull(key.info.budget_reset_at),
  };
}
