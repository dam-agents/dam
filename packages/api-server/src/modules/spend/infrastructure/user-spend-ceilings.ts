import { spendCeilingUsdTextSchema } from "api-server-api";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { SpendCeiling } from "../domain/limits.js";

export interface SpendCeilings {
  forOwner(ownerSub: string): Promise<SpendCeiling | null>;
}

export interface CustomObjectReader {
  getCustomObject(plural: string, name: string): Promise<unknown>;
}

const USER_SPEND_LIMITS_PLURAL = "userspendlimits";
const CACHE_MS = 60_000;

export function createUserSpendCeilings(deps: {
  k8s: CustomObjectReader;
  defaultMicros: number | null;
}): SpendCeilings {
  const fallback: SpendCeiling | null =
    deps.defaultMicros === null
      ? null
      : { amountMicros: deps.defaultMicros, source: "default" };
  const cache = new Map<
    string,
    { readonly ceiling: SpendCeiling | null; readonly readAt: number }
  >();

  const read = async (ownerSub: string): Promise<SpendCeiling | null> => {
    const object = await deps.k8s.getCustomObject(
      USER_SPEND_LIMITS_PLURAL,
      `spend-limit-${ownerSub}`,
    );
    if (!object) return fallback;
    const dailyUsd = (object as { spec?: { dailyUsd?: unknown } }).spec
      ?.dailyUsd;
    const amount = spendCeilingUsdTextSchema.safeParse(dailyUsd);
    if (!amount.success) {
      getLogger().warn(
        { ownerSub, dailyUsd },
        "spend.user_spend_limit_invalid",
      );
      return fallback;
    }
    return { amountMicros: amount.data, source: "UserSpendLimit" };
  };

  return {
    async forOwner(ownerSub) {
      const now = Date.now();
      const cached = cache.get(ownerSub);
      if (cached && now - cached.readAt < CACHE_MS) return cached.ceiling;
      try {
        const ceiling = await read(ownerSub);
        cache.set(ownerSub, { ceiling, readAt: now });
        return ceiling;
      } catch (err) {
        if (!cached) throw err;
        getLogger().warn(
          { ownerSub, reason: formatError(err) },
          "spend.ceiling_read_failed",
        );
        return cached.ceiling;
      }
    },
  };
}
