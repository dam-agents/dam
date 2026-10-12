import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bobBalance,
  liteLlmBalance,
} from "../../modules/connections/domain/provider-balance.js";
import { createProviderBalanceSource } from "../../modules/connections/infrastructure/provider-balance-source.js";

/**
 * TEST_OVERVIEW: the Providers page shows how much of a provider's budget the
 * stored key has used. Bob reports it per team on its profile, and LiteLLM
 * reports it on the key itself.
 */

describe("provider balance", () => {
  it("reads the Bob team the connection pins, with its monthly reset", () => {
    const profile = {
      instances: [
        {
          instance_id: "inst-a",
          refresh_at: 1793491200,
          teams: [{ id: "team-1", budget_limit: 500, usage: 12 }],
        },
        {
          instance_id: "inst-b",
          refresh_at: 1793491200,
          teams: [
            { id: "team-2", budget_limit: 1000, usage: 40 },
            { id: "team-3", budget_limit: 100, usage: 100.11284 },
          ],
        },
      ],
    };

    expect(bobBalance(profile, { teamId: "team-3" })).toEqual({
      unit: "bobcoins",
      used: 100.11284,
      limit: 100,
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
    expect(bobBalance(profile, {})?.limit).toBe(500);
    expect(bobBalance(profile, { instanceId: "inst-c" })).toBeNull();
  });

  it("reads a LiteLLM key's spend, and no limit when the key has none", () => {
    expect(
      liteLlmBalance({
        info: {
          spend: 3.25,
          max_budget: 50,
          budget_reset_at: "2026-11-01T00:00:00Z",
        },
      }),
    ).toEqual({
      unit: "usd",
      used: 3.25,
      limit: 50,
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
    expect(liteLlmBalance({ info: { spend: 7, max_budget: null } })).toEqual({
      unit: "usd",
      used: 7,
      limit: null,
      resetsAt: null,
    });
  });
});

describe("provider balance source", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([401, 403])(
    "shows no balance when Bob refuses the key with %i",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status })),
      );

      await expect(
        createProviderBalanceSource().lookup(
          { kind: "bob", pins: {} },
          "sk-bob",
        ),
      ).resolves.toBeNull();
    },
  );
});
