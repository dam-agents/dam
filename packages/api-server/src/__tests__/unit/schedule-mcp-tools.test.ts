import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";
import type {
  Schedule,
  ScheduleCreateCronInput,
  ScheduleCreateRRuleInput,
  ScheduleCreator,
} from "api-server-api";

/** Drive the create_schedule MCP tool over a real MCP client, so its declared
 *  input schema (and the mutual-exclusivity check inside the handler) is what
 *  gets exercised. `schedules` is stubbed to record what the tool asked for. */
async function mcpHarness() {
  const cronCalls: {
    input: ScheduleCreateCronInput;
    createdBy?: ScheduleCreator;
  }[] = [];
  const rruleCalls: {
    input: ScheduleCreateRRuleInput;
    createdBy?: ScheduleCreator;
  }[] = [];
  const schedules = {
    createCron: vi.fn(
      async (input: ScheduleCreateCronInput, createdBy?: ScheduleCreator) => {
        cronCalls.push({ input, createdBy });
        return {
          id: "sched-1",
          agentId: input.agentId,
          name: input.name,
          spec: {
            version: "1",
            type: "cron" as const,
            cron: input.cron,
            enabled: true,
            createdBy: createdBy ?? "user",
          },
        } satisfies Schedule;
      },
    ),
    createRRule: vi.fn(
      async (input: ScheduleCreateRRuleInput, createdBy?: ScheduleCreator) => {
        rruleCalls.push({ input, createdBy });
        return {
          id: "sched-2",
          agentId: input.agentId,
          name: input.name,
          spec: {
            version: "1",
            type: "rrule" as const,
            rrule: input.rrule,
            timezone: input.timezone,
            enabled: true,
            createdBy: createdBy ?? "user",
          },
        } satisfies Schedule;
      },
    ),
  };

  const session = createMcpSession("agent-1", {
    channelManager: {},
    k8s: { namespace: "platform" },
    maxArtifactBytes: 10 * 1024 * 1024,
    agentHome: "/home/agent",
    schedules,
  } as unknown as McpSessionDeps);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);

  return { client, cronCalls, rruleCalls };
}

describe("create_schedule MCP tool", () => {
  it("still creates a legacy UTC cron schedule when only cron is given", async () => {
    const { client, cronCalls } = await mcpHarness();

    const res = await client.callTool({
      name: "create_schedule",
      arguments: { name: "daily", cron: "0 9 * * *", task: "say hi" },
    });

    expect(res.isError).toBeFalsy();
    expect(cronCalls).toHaveLength(1);
    expect(cronCalls[0].createdBy).toBe("agent");
    expect(cronCalls[0].input).toMatchObject({ cron: "0 9 * * *" });
  });

  it("creates a timezone-pinned rrule schedule, attributed to the agent", async () => {
    const { client, rruleCalls } = await mcpHarness();

    const res = await client.callTool({
      name: "create_schedule",
      arguments: {
        name: "weekday standup",
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
        timezone: "Europe/Prague",
        task: "post the standup summary",
      },
    });

    expect(res.isError).toBeFalsy();
    expect(rruleCalls).toHaveLength(1);
    expect(rruleCalls[0].createdBy).toBe("agent");
    expect(rruleCalls[0].input).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
      timezone: "Europe/Prague",
    });
    const body = JSON.parse((res.content as [{ text: string }])[0].text);
    expect(body).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
      timezone: "Europe/Prague",
    });
    expect(body).not.toHaveProperty("cron");
  });

  it("passes quietHours through to createRRule", async () => {
    const { client, rruleCalls } = await mcpHarness();

    await client.callTool({
      name: "create_schedule",
      arguments: {
        name: "nightly",
        rrule: "FREQ=DAILY;BYHOUR=22;BYMINUTE=0",
        timezone: "Europe/Prague",
        quietHours: [{ startTime: "23:00", endTime: "07:00", enabled: true }],
        task: "run the nightly job",
      },
    });

    expect(rruleCalls[0].input.quietHours).toEqual([
      { startTime: "23:00", endTime: "07:00", enabled: true },
    ]);
  });

  it("refuses when both cron and rrule are given", async () => {
    const { client, cronCalls, rruleCalls } = await mcpHarness();

    const res = await client.callTool({
      name: "create_schedule",
      arguments: {
        name: "ambiguous",
        cron: "0 9 * * *",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        timezone: "Europe/Prague",
        task: "do the thing",
      },
    });

    expect(res.isError).toBe(true);
    expect(cronCalls).toHaveLength(0);
    expect(rruleCalls).toHaveLength(0);
  });

  it("refuses when neither cron nor rrule is given", async () => {
    const { client } = await mcpHarness();

    const res = await client.callTool({
      name: "create_schedule",
      arguments: { name: "empty", task: "do the thing" },
    });

    expect(res.isError).toBe(true);
  });

  it("refuses rrule without a timezone", async () => {
    const { client, rruleCalls } = await mcpHarness();

    const res = await client.callTool({
      name: "create_schedule",
      arguments: {
        name: "no tz",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        task: "do the thing",
      },
    });

    expect(res.isError).toBe(true);
    expect(rruleCalls).toHaveLength(0);
  });
});
