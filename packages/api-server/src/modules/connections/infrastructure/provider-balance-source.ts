import { z } from "zod";
import { BOB_HOST } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import {
  bobBalance,
  liteLlmBalance,
  type ProviderBalanceSource,
} from "../domain/provider-balance.js";

const LOOKUP_TIMEOUT_MS = 10_000;

const nullableNumber = z.number().nullish();

const bobProfileSchema = z.object({
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

const liteLlmKeyInfoSchema = z.object({
  info: z.object({
    spend: nullableNumber,
    max_budget: nullableNumber,
    budget_reset_at: z.string().nullish(),
  }),
});

function get(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    headers,
  });
}

function refused(url: string, res: Response): boolean {
  if (res.status !== 401 && res.status !== 403) return false;
  getLogger().info(
    { url, status: res.status },
    "provider balance: the credential may not read its balance",
  );
  return true;
}

async function json(url: string, res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export function createProviderBalanceSource(): ProviderBalanceSource {
  return {
    async lookup(query, credential) {
      if (query.kind === "litellm") {
        const url = `https://${query.host}/key/info`;
        const res = await get(url, { Authorization: `Bearer ${credential}` });
        if (refused(url, res)) return null;
        return liteLlmBalance(liteLlmKeyInfoSchema.parse(await json(url, res)));
      }
      const url = `https://${BOB_HOST}/admin/v1/profile`;
      const res = await get(url, { Authorization: `Apikey ${credential}` });
      if (refused(url, res)) return null;
      const balance = bobBalance(
        bobProfileSchema.parse(await json(url, res)),
        query.pins,
      );
      if (!balance) throw new Error("Bob profile has no matching team");
      return balance;
    },
  };
}
