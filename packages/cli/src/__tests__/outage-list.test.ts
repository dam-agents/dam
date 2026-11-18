// TEST_OVERVIEW: `dam outage list` reads the Provider Status query and the owner's outage alerts, the same data the bell shows, and prints them as two plain sections: where each provider stands, with its start time and status page, then the alerts, recovered ones included, with the agents each one hits. `--json` prints the status and the alerts as one object.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OutageAlertNotice, ProviderStatusView } from "api-server-api";
import { buildListCommand } from "../modules/outage/commands/list.js";
import { createOutageService } from "../modules/outage/services/outage-service.js";
import type { TrpcClient } from "../modules/shared/trpc/trpc-client.js";
import {
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const ok = <T>(value: T) => ({ ok: true as const, value });

const CHECKED_AT = "2026-11-18T10:00:00.000Z";

function commandFor(trpc: TrpcClient) {
  return buildListCommand({
    compatService: {
      check: async () =>
        ok({
          kind: "ok" as const,
          localCli: "1.0.0",
          serverVersion: "1.0.0",
          serverMinClient: undefined,
          serverRecommendedClient: undefined,
        }),
    },
    configService: {
      getResolved: async () => ok({ server: "http://localhost:4444" }),
      set: vi.fn(),
    },
    createOutageService: () => createOutageService({ trpc }),
  });
}

function makeTrpc(
  providerStatus: ProviderStatusView,
  outageAlerts: OutageAlertNotice[],
): TrpcClient {
  return {
    providerStatus: { list: { query: vi.fn(async () => providerStatus) } },
    attention: {
      listForOwner: { query: vi.fn(async () => ({ outageAlerts })) },
    },
  } as unknown as TrpcClient;
}

let stdout = "";
let stderr = "";

async function parse(trpc: TrpcClient, args: string[], code: number) {
  stdout = "";
  stderr = "";
  await expect(
    commandFor(trpc).parseAsync(args, { from: "user" }),
  ).rejects.toThrow(`exit ${code}`);
  return stdout;
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: unknown, done?: unknown) => {
      stdout += String(chunk);
      if (typeof done === "function") (done as () => void)();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

/**
 * TEST_SCENARIO: A quiet install whose status job has not run in the last
 * three minutes. It says no provider is having problems, and says the check
 * is stale instead of naming a time, while the alerts section says there are
 * none.
 */
it("should say no provider is having problems and that the check is stale", async () => {
  const text = await parse(
    makeTrpc({ damSide: null, outages: [], checkedAt: null }, []),
    [],
    EXIT_SUCCESS,
  );
  expect(text).toBe(
    [
      "Providers",
      "  no provider is having problems",
      "  not checked in the last three minutes",
      "",
      "Your outage alerts",
      "  none",
      "",
    ].join("\n"),
  );
});

/**
 * TEST_SCENARIO: One provider has failed most calls for twenty minutes and
 * one alert was already told and has since recovered. The section names the
 * template, its reason, its start time and its status page; the alerts name
 * the outage as recovered and the agent it hit, with what the agent was doing.
 */
it("should name an outage, its status page, and a recovered alert with its agents", async () => {
  const text = await parse(
    makeTrpc(
      {
        damSide: null,
        outages: [
          {
            templateId: "anthropic-key",
            reason: "failing-calls",
            since: "2026-11-18T09:40:00.000Z",
            statusPageUrl: "https://status.anthropic.com",
          },
        ],
        checkedAt: CHECKED_AT,
      },
      [
        {
          id: "outage-alert-1",
          templateId: "anthropic-key",
          since: "2026-11-18T09:40:00.000Z",
          recoveredAt: "2026-11-18T10:20:00.000Z",
          statusPageUrl: "https://status.anthropic.com",
          agents: [
            {
              agentId: "agent-1",
              name: "weekly-report",
              affectedBy: ["schedule", "slack"],
            },
          ],
        },
      ],
    ),
    [],
    EXIT_SUCCESS,
  );
  expect(text).toBe(
    [
      "Providers",
      "  anthropic-key  failing-calls  since 2026-11-18T09:40:00.000Z  https://status.anthropic.com",
      `  checked ${CHECKED_AT}`,
      "",
      "Your outage alerts",
      "  anthropic-key  since 2026-11-18T09:40:00.000Z  recovered 2026-11-18T10:20:00.000Z",
      "    weekly-report (schedule, slack)",
      "",
    ].join("\n"),
  );
});

/**
 * TEST_SCENARIO: The fault is on the platform's side, so the status names no
 * provider but the platform itself, and `--json` still prints the status and
 * the alerts as one object, which is what a diagnosing agent reads.
 */
it("should print the status and the alerts as one JSON object", async () => {
  const providerStatus: ProviderStatusView = {
    damSide: { since: "2026-11-18T09:55:00.000Z" },
    outages: [],
    checkedAt: CHECKED_AT,
  };
  const alerts: OutageAlertNotice[] = [
    {
      id: "outage-alert-2",
      templateId: "openai",
      since: "2026-11-18T09:30:00.000Z",
      recoveredAt: null,
      statusPageUrl: null,
      agents: [
        { agentId: "agent-2", name: "triage", affectedBy: ["telegram"] },
      ],
    },
  ];
  const text = await parse(
    makeTrpc(providerStatus, alerts),
    ["--json"],
    EXIT_SUCCESS,
  );
  expect(JSON.parse(text)).toEqual({ providerStatus, alerts });
});

/**
 * TEST_SCENARIO: The server refuses the status read. The command says why and
 * exits non-zero rather than print an empty status, which would read as
 * healthy.
 */
it("should fail when the status cannot be read", async () => {
  const trpc = {
    providerStatus: {
      list: {
        query: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      },
    },
  } as unknown as TrpcClient;
  const text = await parse(trpc, [], EXIT_RUNTIME_FAILURE);
  expect(text).toBe("");
  expect(stderr).toContain("connection refused");
});
