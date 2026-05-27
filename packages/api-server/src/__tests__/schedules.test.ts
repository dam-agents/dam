import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import { client } from "./helpers/trpc-client.js";
import {
  waitForPodReady,
  dumpPodLogs,
  describePod,
  getEvents,
} from "./helpers/kubectl.js";

let AGENT_ID: string;

beforeAll(async () => {
  const agent = await client.agents.create.mutate({
    name: "test-agent",
    image: "alpine:latest",
    description: "test agent",
  });
  AGENT_ID = agent.id;
});

afterAll(async () => {
  const schedules = await client.schedules.list.query({
    agentId: AGENT_ID,
  });
  for (const s of schedules) {
    try {
      await client.schedules.delete.mutate({ id: s.id });
    } catch {}
  }
  try {
    await client.agents.delete.mutate({ id: AGENT_ID });
  } catch {}
});

let cronScheduleId: string;
let secondCronScheduleId: string;

describe("schedules: API server CRUD", () => {
  describe("create cron schedule", () => {
    it("returns correct fields", async () => {
      const result = await client.schedules.createCron.mutate({
        name: "daily-report",
        agentId: AGENT_ID,
        cron: "0 9 * * *",
        task: "generate report",
      });

      cronScheduleId = result.id;
      expect(result.name).toBe("daily-report");
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.type).toBe("cron");
      expect(result.cron).toBe("0 9 * * *");
      expect(result.task).toBe("generate report");
      expect(result.enabled).toBe(true);
      expect(result.status).toBeNull();
    });

    it("rejects invalid cron expression", async () => {
      await expect(
        client.schedules.createCron.mutate({
          name: "bad-cron",
          agentId: AGENT_ID,
          cron: "not-a-cron",
          task: "test",
        }),
      ).rejects.toThrow();
    });
  });

  describe("create second cron schedule", () => {
    it("returns correct fields", async () => {
      const result = await client.schedules.createCron.mutate({
        name: "health-check",
        agentId: AGENT_ID,
        cron: "*/5 * * * *",
        task: "check health",
      });

      secondCronScheduleId = result.id;
      expect(result.name).toBe("health-check");
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.type).toBe("cron");
      expect(result.cron).toBe("*/5 * * * *");
      expect(result.enabled).toBe(true);
    });
  });

  describe("list schedules", () => {
    it("returns all schedules for the agent", async () => {
      const list = await client.schedules.list.query({
        agentId: AGENT_ID,
      });

      expect(list).toHaveLength(2);
      const names = list.map((s) => s.name).sort();
      expect(names).toEqual(["daily-report", "health-check"]);
    });

    it("returns empty array for agent with no schedules", async () => {
      const list = await client.schedules.list.query({
        agentId: "nonexistent",
      });
      expect(list).toEqual([]);
    });
  });

  describe("toggle enable/disable", () => {
    it("toggles enabled from true to false", async () => {
      const result = await client.schedules.toggle.mutate({
        id: cronScheduleId,
      });
      expect(result.enabled).toBe(false);
    });

    it("toggles back to true", async () => {
      const result = await client.schedules.toggle.mutate({
        id: cronScheduleId,
      });
      expect(result.enabled).toBe(true);
    });

    it("returns NOT_FOUND for non-existent schedule", async () => {
      try {
        await client.schedules.toggle.mutate({ id: "no-such-schedule" });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TRPCClientError);
        expect((e as TRPCClientError<AppRouter>).data?.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("delete schedule", () => {
    it("deletes the schedule", async () => {
      await client.schedules.delete.mutate({ id: cronScheduleId });

      const list = await client.schedules.list.query({
        agentId: AGENT_ID,
      });
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("health-check");
    });
  });

  describe("read schedule status", () => {
    it("populates nextRun on a freshly created schedule", async () => {
      const sched = await client.schedules.get.query({
        id: secondCronScheduleId,
      });
      expect(sched.status).not.toBeNull();
      expect(sched.status!.nextRun).toBeTruthy();
    });

    it("returns NOT_FOUND for non-existent schedule", async () => {
      try {
        await client.schedules.get.query({ id: "no-such-schedule" });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TRPCClientError);
        expect((e as TRPCClientError<AppRouter>).data?.code).toBe("NOT_FOUND");
      }
    });
  });
});

describe("e2e: cron firing", () => {
  let e2eAgentId: string;
  let e2eScheduleId: string;

  beforeAll(async () => {
    // Free the node before scheduling the heavier claude-code pod — the
    // CRUD suite's alpine agent is otherwise still running and competes
    // for memory on the small test VM. The outer afterAll re-attempts the
    // delete and tolerates "not found", so this is safe to do early.
    try {
      await client.agents.delete.mutate({ id: AGENT_ID });
    } catch {}

    const agent = await client.agents.create.mutate({
      name: "e2e-agent",
      templateId: "claude-code",
    });
    e2eAgentId = agent.id;
    await waitForPodReady(`${e2eAgentId}-0`, 180_000);
  });

  afterAll(async () => {
    try {
      if (e2eScheduleId)
        await client.schedules.delete.mutate({ id: e2eScheduleId });
    } catch {}
    try {
      await client.agents.delete.mutate({ id: e2eAgentId });
    } catch {}
  });

  it("records lastResult after cron fires", async () => {
    const sched = await client.schedules.createCron.mutate({
      name: "e2e-cron",
      agentId: e2eAgentId,
      cron: "* * * * *",
      task: "e2e test task",
    });
    e2eScheduleId = sched.id;

    try {
      const status = await waitForScheduleFire(e2eScheduleId, 120_000);
      expect(status.lastResult).toBe("success");
      expect(status.lastRun).toBeTruthy();
      expect(status.nextRun).toBeTruthy();
    } catch (e) {
      const podName = `${e2eAgentId}-0`;
      const [apiLogs, podInfo, podLogs, podEvents, last] = await Promise.all([
        dumpPodLogs("app.kubernetes.io/component=api-server"),
        describePod(podName),
        dumpPodLogs(`agent-platform.ai/agent=${e2eAgentId}`, "platform-agents"),
        getEvents(podName),
        client.schedules.get.query({ id: e2eScheduleId }).catch(() => null),
      ]);
      console.error(
        [
          "=== API Server Logs ===",
          apiLogs,
          "=== Agent Pod Describe ===",
          podInfo,
          "=== Agent Pod Logs (incl. init) ===",
          podLogs,
          "=== Agent Pod Events ===",
          podEvents,
          "=== Schedule (last fetch) ===",
          JSON.stringify(last, null, 2),
        ].join("\n"),
      );
      throw e;
    }
  });
});

async function waitForScheduleFire(
  scheduleId: string,
  timeoutMs: number,
): Promise<{ lastResult: string; lastRun?: string; nextRun?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sched = await client.schedules.get.query({ id: scheduleId });
    if (sched.status?.lastResult) {
      return sched.status as {
        lastResult: string;
        lastRun?: string;
        nextRun?: string;
      };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    `Schedule ${scheduleId} did not record a fire within ${timeoutMs}ms`,
  );
}
