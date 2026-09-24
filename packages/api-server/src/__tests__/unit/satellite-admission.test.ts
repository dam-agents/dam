import { describe, expect, it } from "vitest";
import {
  RESERVED_TOOL_NAMES,
  satelliteToolNameSchema,
  type SatelliteTool,
  type SatelliteView,
} from "api-server-api";
import { registerSatelliteTools } from "../../modules/satellites/mcp-tools.js";
import {
  admit,
  isOnline,
  OFFLINE_AFTER_MS,
} from "../../modules/satellites/domain/admission.js";
import type {
  JobRow,
  SatelliteRow,
} from "../../modules/satellites/domain/types.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";
import { composeSatellitesModule } from "../../modules/satellites/compose.js";

/**
 * TEST_OVERVIEW: Admission — whether a tool call becomes a Job at all. It is
 * deliberately all-or-nothing, because a call reports the Job as running and
 * that has to be true: a Job is accepted only when a worker will pick it up
 * within a poll interval, and anything else is refused with a reason the model
 * can act on. Admission now decides only what the platform can know from the
 * Snapshot — that the machine is there, is not shutting down, offers this tool
 * and has room. What the arguments mean, and whether this call needs a human,
 * are the machine's questions, so no spec here asserts on either.
 */

const NOW = new Date("2026-09-17T12:00:00Z");

const TOOLS: SatelliteTool[] = [
  { name: "run", inputSchema: { type: "object" } },
  { name: "train", inputSchema: { type: "object" }, maxConcurrent: 1 },
];

function satellite(patch: Partial<SatelliteRow> = {}): SatelliteRow {
  return {
    owner: "alice",
    name: "gpu-box",
    description: null,
    host: "gpu-box.internal",
    maxConcurrent: 16,
    tools: TOOLS,
    draining: false,
    lastSeenAt: new Date(NOW.getTime() - 1000),
    ...patch,
  };
}

const NO_ACTIVE = { total: 0, byTool: new Map<string, number>() };

describe("admission", () => {
  it("admits a call to a tool the satellite offers", () => {
    const verdict = admit(satellite(), "run", NO_ACTIVE, NOW);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.tool.name).toBe("run");
  });

  it("refuses a tool the snapshot does not list, and says what it does offer", () => {
    const verdict = admit(satellite(), "rm", NO_ACTIVE, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("run, train");
  });

  it("refuses while the satellite is offline rather than queueing", () => {
    const stale = satellite({
      lastSeenAt: new Date(NOW.getTime() - OFFLINE_AFTER_MS - 1),
    });
    const verdict = admit(stale, "run", NO_ACTIVE, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("offline");
  });

  it("refuses while draining", () => {
    expect(admit(satellite({ draining: true }), "run", NO_ACTIVE, NOW).ok).toBe(
      false,
    );
  });

  /**
   * TEST_SCENARIO: Draining is cleared only by a claim, so a machine that
   * drained and exited stays marked draining after it is gone. Once it is past
   * the offline window, the reason must say it is offline: "shutting down"
   * tells the model to wait for something that has already happened.
   */
  it("calls a machine that drained and left offline, not shutting down", () => {
    const gone = satellite({
      draining: true,
      lastSeenAt: new Date(NOW.getTime() - OFFLINE_AFTER_MS - 1),
    });
    const verdict = admit(gone, "run", NO_ACTIVE, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("offline");
  });

  it("refuses at the satellite's concurrency limit", () => {
    const verdict = admit(
      satellite({ maxConcurrent: 2 }),
      "run",
      { total: 2, byTool: new Map() },
      NOW,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("max 2");
  });

  it("refuses at a tool's own limit while others still start", () => {
    const active = { total: 1, byTool: new Map([["train", 1]]) };
    expect(admit(satellite(), "train", active, NOW).ok).toBe(false);
    expect(admit(satellite(), "run", active, NOW).ok).toBe(true);
  });
});

describe("online", () => {
  it("needs a heartbeat inside the window", () => {
    expect(isOnline(satellite(), NOW)).toBe(true);
    expect(isOnline(satellite({ lastSeenAt: null }), NOW)).toBe(false);
    expect(
      isOnline(
        satellite({ lastSeenAt: new Date(NOW.getTime() - OFFLINE_AFTER_MS) }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("draining", () => {
  it("survives a heartbeat, and ends when the machine claims again", async () => {
    const calls: string[] = [];
    const repo = {
      get: async () => satellite({ draining: true }),
      touch: async () => {
        calls.push("touch");
      },
      setDraining: async (_o: string, _n: string, value: boolean) => {
        calls.push(`setDraining:${value}`);
      },
      renewLeases: async () => {},
      claimQueued: async () => [],
      takeCancellations: async () => [],
    };
    const ops = createSatelliteWorkerOps({
      repo: repo as never,
      maxConcurrentCeiling: 64,
      deliverOutcome: async () => {},
    });

    await ops.heartbeat("alice", { satellite: "gpu-box", running: [] });
    expect(
      calls,
      "a machine that is shutting down must not un-shut itself on its own beat",
    ).toEqual(["touch"]);

    await ops.claim("alice", { satellite: "gpu-box", capacity: 4, waitMs: 0 });
    expect(
      calls,
      "but a draining worker stops claiming, so a claim means it is serving again",
    ).toContain("setDraining:false");

    await ops.drain("alice", "gpu-box");
    expect(calls).toContain("setDraining:true");
  });
});

describe("revocation", () => {
  it("settles what has not started, and tells the agent", async () => {
    const delivered: string[] = [];
    const stopped: { scope: unknown; reason: string }[] = [];
    const composition = composeSatellitesModule({
      db: {} as never,
      maxConcurrentCeiling: 64,
      ownerOf: async () => "alice",
      isAgentOwnedBy: async () => true,
      spillLog: async () => null,
      deliverOutcome: async ({ satellite, sequence }) => {
        delivered.push(`${satellite}#${sequence}`);
      },
    });
    (composition.repo as unknown as Record<string, unknown>).stopDispatch =
      async (scope: unknown, reason: string) => {
        stopped.push({ scope, reason });
        return [
          {
            owner: "alice",
            agentId: "agent-1",
            satellite: "gpu-box",
            sequence: 7,
          },
        ];
      };
    (composition.repo as unknown as Record<string, unknown>).revokeAgentGrants =
      async () => {};

    await composition.onAgentDeleted("agent-1");

    expect(stopped[0]?.scope).toEqual({ agentId: "agent-1" });
    expect(delivered).toEqual(["gpu-box#7"]);
  });
});

describe("a cancel that races the worker's claim", () => {
  it("does not overwrite a job the worker started between the read and the write", async () => {
    const requested: number[] = [];
    let status = "queued";
    const composition = composeSatellitesModule({
      db: {} as never,
      maxConcurrentCeiling: 64,
      ownerOf: async () => "alice",
      isAgentOwnedBy: async () => true,
      spillLog: async () => null,
      deliverOutcome: async () => {},
    });
    const repo = composition.repo as unknown as Record<string, unknown>;
    repo.get = async () => satellite();
    repo.getJob = async () => ({
      owner: "alice",
      satellite: "gpu-box",
      sequence: 7,
      agentId: "agent-1",
      status,
      cmd: ["./process.sh", "sales.db"],
    });
    repo.settle = async (
      _o: string,
      _n: string,
      _s: number,
      _patch: unknown,
      expect_: string | undefined,
    ) => {
      status = "running";
      return expect_ === undefined || expect_ === "running" ? {} : null;
    };
    repo.requestCancel = async (_o: string, _n: string, sequence: number) => {
      requested.push(sequence);
    };

    await composition.serviceFor("alice", "*").cancelJob("gpu-box", 7);

    expect(
      requested,
      "the row moved to running under the read, so the write must not land and the cancel becomes a request",
    ).toEqual([7]);
  });
});

describe("a job that finishes while its agent is waiting", () => {
  it("is claimed by the wait before the wake delivery can take it", async () => {
    const calls: string[] = [];
    let status = "running";
    const composition = composeSatellitesModule({
      db: {} as never,
      maxConcurrentCeiling: 64,
      ownerOf: async () => "alice",
      isAgentOwnedBy: async () => true,
      spillLog: async () => null,
      deliverOutcome: async () => {},
    });
    const repo = composition.repo as unknown as Record<string, unknown>;
    repo.get = async () => satellite();
    repo.grantedNames = async () => [{ owner: "alice", name: "gpu-box" }];
    repo.isGranted = async () => true;
    repo.markAwaited = async () => {
      calls.push("markAwaited");
      status = "done";
    };
    repo.getJob = async () => {
      calls.push("getJob");
      return {
        owner: "alice",
        satellite: "gpu-box",
        sequence: 7,
        agentId: "agent-1",
        status,
        cmd: ["./process.sh", "sales.db"],
        exitCode: 0,
        output: "",
        truncated: false,
        reason: null,
      };
    };
    repo.markSeen = async () => {
      calls.push("markSeen");
      return true;
    };

    await composition.agentOps.wait("agent-1", "gpu-box", 7, 0);

    expect(
      calls[0],
      "the lease must be taken before the first read, or the report path claims the outcome first",
    ).toBe("markAwaited");
  });
});

describe("a satellite's own tool names", () => {
  /**
   * TEST_SCENARIO: The platform registers wait, get and cancel beside a
   * Satellite's tools under the same scoped prefix. A Satellite offering one of
   * those would register a name the platform has already taken, and a duplicate
   * registration fails the whole MCP session — so one machine could take down an
   * Agent's entire tool surface. The name is refused when the machine connects,
   * where the error reaches the person who can rename it.
   */
  it("may not take a name the platform registers beside them", () => {
    for (const reserved of RESERVED_TOOL_NAMES)
      expect(
        satelliteToolNameSchema.safeParse(reserved).success,
        `${reserved} is the platform's own verb`,
      ).toBe(false);
    expect(satelliteToolNameSchema.safeParse("waiting").success).toBe(true);
    expect(satelliteToolNameSchema.safeParse("run").success).toBe(true);
  });
});

describe("a call that outlives its inline wait", () => {
  /**
   * TEST_SCENARIO: A tool call blocks for a while and then hands back a job
   * reference. By then the machine has usually claimed the Job, so the status
   * in the reference must be the one the wait read, not the one the Job was
   * inserted with: a model reading "queued" would think it never started.
   */
  it("reports the status the wait saw, not the one the job was inserted with", async () => {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = {
      registerTool: (
        n: string,
        _config: unknown,
        handler: (args: unknown) => Promise<unknown>,
      ) => handlers.set(n, handler),
      tool: () => {},
    };
    registerSatelliteTools(server as never, {
      ops: {
        start: async () => ({
          ref: "gpu-box#7",
          satellite: "gpu-box",
          sequence: 7,
          status: "queued",
        }),
        wait: async () => ({
          ref: "gpu-box#7",
          status: "running",
          isError: false,
          exitCode: null,
          output: null,
          outputPath: null,
          truncated: false,
          reason: null,
        }),
      } as never,
      agentId: "agent-1",
      satellites: [
        {
          name: "gpu-box",
          description: null,
          host: null,
          online: true,
          draining: false,
          lastSeenAt: null,
          tools: [{ name: "run", inputSchema: { type: "object" } }],
          maxConcurrent: 16,
          activeJobs: 0,
          grantedAgentIds: [],
        },
      ],
      waitDeadlineMs: 1000,
    });
    const result = (await handlers.get("gpu_box__run")?.({
      cmd: ["./slow.sh"],
    })) as { content: { text: string }[] };
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      ref: "gpu-box#7",
      status: "running",
    });
  });
});

describe("the tool names the platform registers", () => {
  function registered(satellites: SatelliteView[]): string[] {
    const names: string[] = [];
    const server = {
      registerTool: (n: string) => names.push(n),
      tool: (n: string) => names.push(n),
    };
    registerSatelliteTools(server as never, {
      ops: {} as never,
      agentId: "agent-1",
      satellites,
      waitDeadlineMs: 1000,
    });
    return names;
  }

  function view(name: string, tools: string[]): SatelliteView {
    return {
      name,
      description: null,
      host: null,
      online: true,
      draining: false,
      lastSeenAt: null,
      tools: tools.map((t) => ({ name: t, inputSchema: { type: "object" } })),
      maxConcurrent: 16,
      activeJobs: 0,
      grantedAgentIds: [],
    };
  }

  /**
   * TEST_SCENARIO: A tool name may itself hold the scope separator, so two
   * different Satellites can render the same registered name — `gpu` offering
   * `box__run` and `gpu--box` offering `run` both give `gpu__box__run`. MCP
   * fails the whole session on a duplicate registration, so one machine would
   * take an Agent's entire tool surface down. Deduplication therefore has to be
   * across every Satellite, not within one.
   */
  it("never registers one name twice, even across two satellites", () => {
    const names = registered([
      view("gpu", ["box__run"]),
      view("gpu--box", ["run"]),
    ]);
    expect(new Set(names).size, `duplicate in ${names.join(", ")}`).toBe(
      names.length,
    );
    expect(names).toContain("gpu__box__run");
  });

  /**
   * TEST_SCENARIO: The platform's own verbs collide the same way a tool does.
   * `gpu` offering `box__wait` registers `gpu__box__wait`, which is exactly what
   * `gpu--box`'s own wait verb renders. Guarding only the tools left the verbs
   * throwing out of the route handler, so every registered name goes through one
   * claim.
   */
  it("never registers a verb that a tool on another satellite already took", () => {
    const names = registered([
      view("gpu", ["box__wait"]),
      view("gpu--box", ["run"]),
    ]);
    expect(new Set(names).size, `duplicate in ${names.join(", ")}`).toBe(
      names.length,
    );
  });

  /**
   * TEST_SCENARIO: The job verbs are what an Agent uses to reach any job at all,
   * so a tool on one machine must not be able to take another machine's verb.
   * `gpu` offering `box__wait` renders exactly what `gpu--box`'s own wait verb
   * renders; claiming every machine's verbs before any machine's tools is what
   * decides that contest in the verb's favour. Both sides render the one name,
   * so the spec counts it rather than naming a winner.
   */
  it("gives a job verb to its own satellite, not to another's tool", () => {
    const names = registered([
      view("gpu", ["box__wait"]),
      view("gpu--box", ["run"]),
    ]);
    expect(names.filter((n) => n === "gpu__box__wait")).toHaveLength(1);
    expect(names, "gpu--box keeps every verb it needs").toEqual(
      expect.arrayContaining([
        "gpu__box__wait",
        "gpu__box__get",
        "gpu__box__cancel",
        "gpu__box__run",
      ]),
    );
    expect(names, "gpu's colliding tool is the one dropped").toHaveLength(7);
  });

  it("keeps its own verbs, and drops a satellite tool that would shadow one", () => {
    const names = registered([view("box", ["run"])]);
    expect(names).toEqual(["box__run", "box__wait", "box__get", "box__cancel"]);
  });

  /**
   * TEST_SCENARIO: A shell Satellite started without a name is called
   * user@hostname, and a hostname usually carries dots. Neither character is
   * one an MCP tool name may hold, so both fold into the separator's own
   * underscore rather than failing the Agent's session.
   */
  it("folds the @ and dots of a user@hostname satellite into a valid tool name", () => {
    const names = registered([view("jan@lab.local", ["run"])]);
    expect(names).toContain("jan_lab_local__run");
    expect(names.every((n) => /^[a-z0-9_]+$/.test(n))).toBe(true);
  });
});

describe("a claimed call", () => {
  const queued: JobRow = {
    owner: "alice",
    satellite: "gpu-box",
    sequence: 7,
    agentId: "agent-1",
    tool: "run",
    args: { cmd: ["./process.sh"] },
    status: "running",
    isError: false,
    exitCode: null,
    output: null,
    truncated: false,
    reason: null,
    cancelRequested: false,
    cancelSentAt: null,
    deliveredAt: null,
    wokeAt: null,
    awaitedUntil: null,
    startedAt: NOW,
    endedAt: null,
    createdAt: NOW,
  };

  function claimWith(agentName: (id: string) => Promise<string | null>) {
    const repo = {
      get: async () => satellite(),
      touch: async () => {},
      setDraining: async () => {},
      takeCancellations: async () => [],
      claimQueued: async () => [queued],
    };
    return createSatelliteWorkerOps({
      repo: repo as never,
      maxConcurrentCeiling: 64,
      deliverOutcome: async () => {},
      agentName,
    }).claim("alice", { satellite: "gpu-box", capacity: 4, waitMs: 0 });
  }

  it("names the agent that sent it, for the machine's log", async () => {
    const [item] = await claimWith(async () => "Builder");
    expect(item).toMatchObject({
      kind: "call",
      agent: { id: "agent-1", name: "Builder" },
    });
  });

  it("still goes out when the name cannot be looked up", async () => {
    const [item] = await claimWith(async () => {
      throw new Error("db down");
    });
    expect(item).toMatchObject({ agent: { id: "agent-1", name: null } });
  });
});
