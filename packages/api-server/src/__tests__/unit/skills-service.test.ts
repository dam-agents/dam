import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Agent, Skill, SkillRef, SkillSource, Template } from "api-server-api";
import {
  createSkillsService,
  templateSourceId,
} from "../../modules/skills/services/skills-service.js";
import {
  SkillSourceProtectedError,
  type SkillsRepository,
} from "../../modules/skills/infrastructure/skills-repository.js";
import type { InstanceSkillsRepository } from "../../modules/skills/infrastructure/instance-skills-repository.js";
import type { SkillSourceSeed } from "../../modules/skills/infrastructure/seed-sources.js";
import { PublicArchiveNotFoundError } from "../../modules/skills/infrastructure/public-archive-scanner.js";
import type { InstancesRepository } from "../../modules/agents/infrastructure/instances-repository.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { TemplatesRepository } from "../../modules/agents/infrastructure/templates-repository.js";
import type { AgentRuntimeSkillsClient } from "../../modules/skills/infrastructure/agent-runtime-client.js";
import type { InfraInstance } from "../../modules/agents/domain/instance-assembly.js";

function emptyTemplatesRepo(): TemplatesRepository {
  return {
    list: async () => [],
    get: async () => null,
    readSpec: async () => null,
  };
}

const OWNER = "user-1";
const INSTANCE_ID = "inst-42";
const AGENT_ID = "agent-1";
const SOURCE: SkillSource = {
  id: "skill-src-abc",
  name: "Apocohq",
  gitUrl: "https://github.com/apocohq/skills",
};

function makeRepo(overrides: Partial<SkillsRepository> = {}): SkillsRepository {
  return {
    list: async () => [SOURCE],
    get: async (id, owner) => (id === SOURCE.id && owner === OWNER ? SOURCE : null),
    create: async (input) => ({ id: "skill-src-new", name: input.name, gitUrl: input.gitUrl }),
    delete: async () => {},
    ...overrides,
  };
}

function makeInfraInstance(overrides: Partial<InfraInstance> = {}): InfraInstance {
  return {
    id: INSTANCE_ID,
    name: "inst",
    agentId: AGENT_ID,
    desiredState: "running",
    currentState: "running",
    podReady: true,
    ...overrides,
  };
}

function makeAgent(skillPaths?: string[]): Agent {
  return {
    id: AGENT_ID,
    name: "a",
    spec: {
      version: "humr.ai/v1",
      name: "a",
      image: "x",
      ...(skillPaths ? { skillPaths } : {}),
    },
  };
}

interface InstanceSkillsState {
  installed: SkillRef[];
}

/** In-memory fake of the new InstanceSkillsRepository. The service no longer
 *  patches `instance.spec.yaml` — it writes to this repo. Tests that check
 *  installed-state mutations now read it back instead of asserting against
 *  `instancesRepo.updateSpec` calls. */
function makeInstanceSkillsRepo(initial: SkillRef[] = []): InstanceSkillsRepository & {
  state: InstanceSkillsState;
} {
  const state: InstanceSkillsState = { installed: [...initial] };
  const removeBySource = vi.fn(async (instanceIds: string[], gitUrl: string) => {
    if (!instanceIds.includes(INSTANCE_ID)) return;
    state.installed = state.installed.filter((s) => s.source !== gitUrl);
  });
  return {
    state,
    listSkills: async (instanceId) => (instanceId === INSTANCE_ID ? [...state.installed] : []),
    upsertSkill: async (_instanceId, ref) => {
      state.installed = state.installed.filter(
        (s) => !(s.source === ref.source && s.name === ref.name),
      );
      state.installed.push(ref);
    },
    removeSkill: async (_instanceId, key) => {
      state.installed = state.installed.filter(
        (s) => !(s.source === key.source && s.name === key.name),
      );
    },
    removeBySource,
    reconcile: async (_instanceId, present) => {
      state.installed = state.installed.filter((s) => present.has(s.name));
    },
    listPublishes: async () => [],
    appendPublish: async () => {},
    deleteByInstance: async () => {},
  };
}

interface Env {
  instancesGet: ReturnType<typeof vi.fn>;
  agentsGet: ReturnType<typeof vi.fn>;
  runtimeInstall: ReturnType<typeof vi.fn>;
  runtimeUninstall: ReturnType<typeof vi.fn>;
  getAgentToken: ReturnType<typeof vi.fn>;
  instanceSkillsRepo: ReturnType<typeof makeInstanceSkillsRepo>;
  svc: ReturnType<typeof createSkillsService>;
}

function makeEnv(opts: {
  instance?: InfraInstance | null;
  agent?: Agent | null;
  runtimeError?: Error;
  runtimeUninstallError?: Error;
  initialInstalled?: SkillRef[];
  seeds?: SkillSourceSeed[];
} = {}): Env {
  const infra = opts.instance ?? makeInfraInstance();
  const instancesGet = vi.fn().mockResolvedValue(infra);
  const agentsGet = vi.fn().mockResolvedValue(opts.agent ?? makeAgent(["/home/agent/.claude/skills/"]));
  const runtimeInstall = opts.runtimeError
    ? vi.fn().mockRejectedValue(opts.runtimeError)
    : vi.fn().mockResolvedValue({ contentHash: "runtime-computed-hash" });
  const runtimeUninstall = opts.runtimeUninstallError
    ? vi.fn().mockRejectedValue(opts.runtimeUninstallError)
    : vi.fn().mockResolvedValue(undefined);

  const instancesRepo = { get: instancesGet, list: vi.fn().mockResolvedValue([]) } as unknown as InstancesRepository;
  const agentsRepo = { get: agentsGet } as unknown as AgentsRepository;
  const runtimeClient: AgentRuntimeSkillsClient = {
    install: runtimeInstall as unknown as AgentRuntimeSkillsClient["install"],
    uninstall: runtimeUninstall as unknown as AgentRuntimeSkillsClient["uninstall"],
    listLocal: vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([]),
    publish: vi.fn<AgentRuntimeSkillsClient["publish"]>().mockResolvedValue({ prUrl: "x", branch: "y" }),
    scan: vi.fn<AgentRuntimeSkillsClient["scan"]>().mockResolvedValue([]),
  };

  const getAgentToken = vi.fn<(agentId: string) => Promise<string>>().mockResolvedValue("agent-token-xyz");
  const instanceSkillsRepo = makeInstanceSkillsRepo(opts.initialInstalled ?? []);

  const svc = createSkillsService({
    repo: makeRepo(),
    instanceSkillsRepo,
    instancesRepo,
    agentsRepo,
    templatesRepo: emptyTemplatesRepo(),
    seedSources: opts.seeds ?? [],
    runtimeClient,
    getAgentToken,
    owner: OWNER,
    scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
    invalidateScan: vi.fn(),
    scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
  });

  return { instancesGet, agentsGet, runtimeInstall, runtimeUninstall, getAgentToken, instanceSkillsRepo, svc };
}

const installInput = {
  instanceId: INSTANCE_ID,
  source: SOURCE.gitUrl,
  name: "adr",
  version: "sha-v1",
};

describe("skills-service install", () => {
  it("calls agent-runtime, then upserts the skill row", async () => {
    const env = makeEnv();
    const result = await env.svc.installSkill(installInput);

    expect(env.runtimeInstall).toHaveBeenCalledTimes(1);
    expect(env.runtimeInstall).toHaveBeenCalledWith(INSTANCE_ID, "agent-token-xyz", {
      source: SOURCE.gitUrl,
      name: "adr",
      version: "sha-v1",
      skillPaths: ["/home/agent/.claude/skills/"],
    });
    expect(env.instanceSkillsRepo.state.installed).toEqual([
      { source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "runtime-computed-hash" },
    ]);
    expect(result).toEqual([
      { source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "runtime-computed-hash" },
    ]);
  });

  it("prefers the UI-scan-provided contentHash over the agent-runtime-computed one", async () => {
    const env = makeEnv();
    await env.svc.installSkill({ ...installInput, contentHash: "from-scan" });
    expect(env.instanceSkillsRepo.state.installed).toEqual([
      { source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "from-scan" },
    ]);
  });

  it("replaces an existing entry with the same (source,name) rather than duplicating", async () => {
    const existing: SkillRef[] = [
      { source: SOURCE.gitUrl, name: "adr", version: "old-sha" },
      { source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" },
    ];
    const env = makeEnv({ initialInstalled: existing });

    await env.svc.installSkill(installInput);

    expect(env.instanceSkillsRepo.state.installed).toEqual([
      { source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" },
      { source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "runtime-computed-hash" },
    ]);
  });

  it("falls back to the default skillPath when the agent has none", async () => {
    const env = makeEnv({ agent: makeAgent() });
    await env.svc.installSkill(installInput);
    expect(env.runtimeInstall).toHaveBeenCalledWith(INSTANCE_ID, "agent-token-xyz", expect.objectContaining({
      skillPaths: ["/home/agent/.agents/skills/"],
    }));
  });

  it("throws PRECONDITION_FAILED when the instance is not running, without calling agent-runtime", async () => {
    const env = makeEnv({ instance: makeInfraInstance({ currentState: "hibernated" }) });
    await expect(env.svc.installSkill(installInput)).rejects.toThrow(TRPCError);
    await expect(env.svc.installSkill(installInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(env.runtimeInstall).not.toHaveBeenCalled();
    expect(env.instanceSkillsRepo.state.installed).toEqual([]);
  });

  it("throws NOT_FOUND when the instance is missing", async () => {
    const env = makeEnv({ instance: undefined });
    env.instancesGet.mockResolvedValueOnce(null);
    await expect(env.svc.installSkill(installInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(env.runtimeInstall).not.toHaveBeenCalled();
  });

  it("does not write the skill row when agent-runtime fails", async () => {
    const env = makeEnv({ runtimeError: new Error("agent-runtime unreachable") });
    await expect(env.svc.installSkill(installInput)).rejects.toThrow(/unreachable/);
    expect(env.instanceSkillsRepo.state.installed).toEqual([]);
  });
});

describe("skills-service uninstall", () => {
  it("calls agent-runtime, then removes the matching (source,name) row", async () => {
    const existing: SkillRef[] = [
      { source: SOURCE.gitUrl, name: "adr", version: "sha-v1" },
      { source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" },
    ];
    const env = makeEnv({ initialInstalled: existing });

    const result = await env.svc.uninstallSkill({
      instanceId: INSTANCE_ID,
      source: SOURCE.gitUrl,
      name: "adr",
    });

    expect(env.runtimeUninstall).toHaveBeenCalledWith(INSTANCE_ID, "agent-token-xyz", {
      name: "adr",
      skillPaths: ["/home/agent/.claude/skills/"],
    });
    expect(env.instanceSkillsRepo.state.installed).toEqual([
      { source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" },
    ]);
    expect(result).toEqual([{ source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" }]);
  });

  it("leaves the row alone when agent-runtime fails", async () => {
    const existing: SkillRef[] = [
      { source: SOURCE.gitUrl, name: "adr", version: "sha-v1" },
    ];
    const env = makeEnv({ initialInstalled: existing, runtimeUninstallError: new Error("boom") });
    await expect(
      env.svc.uninstallSkill({ instanceId: INSTANCE_ID, source: SOURCE.gitUrl, name: "adr" }),
    ).rejects.toThrow(/boom/);
    expect(env.instanceSkillsRepo.state.installed).toEqual(existing);
  });
});

describe("skills-service listLocal", () => {
  it("returns local skills from agent-runtime minus those already tracked by name", async () => {
    const runtimeListLocal = vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([
      { name: "adr", description: "", skillPath: "/home/agent/.claude/skills/" },
      { name: "my-draft", description: "work in progress", skillPath: "/home/agent/.claude/skills/" },
    ]);
    const instanceSkillsRepo = makeInstanceSkillsRepo([
      { source: "https://x/x", name: "adr", version: "sha" },
    ]);
    const svc = createSkillsService({
      repo: makeRepo(),
      instanceSkillsRepo,
      instancesRepo: { get: vi.fn().mockResolvedValue(makeInfraInstance()) } as unknown as InstancesRepository,
      agentsRepo: { get: vi.fn().mockResolvedValue(makeAgent(["/home/agent/.claude/skills/"])) } as unknown as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
        publish: vi.fn(),
        scan: vi.fn(),
      },
      getAgentToken: async () => "agent-token-xyz",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    const result = await svc.listLocal(INSTANCE_ID);

    expect(runtimeListLocal).toHaveBeenCalledWith(
      INSTANCE_ID,
      "agent-token-xyz",
      ["/home/agent/.claude/skills/"],
    );
    expect(result).toEqual([
      { name: "my-draft", description: "work in progress", skillPath: "/home/agent/.claude/skills/" },
    ]);
  });

  it("returns empty when the instance is not running", async () => {
    const runtimeListLocal = vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([]);
    const svc = createSkillsService({
      repo: makeRepo(),
      instanceSkillsRepo: makeInstanceSkillsRepo(),
      instancesRepo: {
        get: vi.fn().mockResolvedValue(makeInfraInstance({ currentState: "hibernated", desiredState: "hibernated" })),
      } as unknown as InstancesRepository,
      agentsRepo: { get: vi.fn() } as unknown as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
        publish: vi.fn(),
        scan: vi.fn(),
      },
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    expect(await svc.listLocal(INSTANCE_ID)).toEqual([]);
    expect(runtimeListLocal).not.toHaveBeenCalled();
  });

  it("returns empty when the instance is missing", async () => {
    const svc = createSkillsService({
      repo: makeRepo(),
      instanceSkillsRepo: makeInstanceSkillsRepo(),
      instancesRepo: { get: vi.fn().mockResolvedValue(null) } as unknown as InstancesRepository,
      agentsRepo: { get: vi.fn() } as unknown as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: vi.fn(),
        publish: vi.fn(),
        scan: vi.fn(),
      },
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    expect(await svc.listLocal("ghost")).toEqual([]);
  });
});

describe("skills-service listSkills routing", () => {
  type RuntimeScan = AgentRuntimeSkillsClient["scan"];
  type PublicScan = (gitUrl: string) => Promise<Skill[]>;
  function buildSvc(opts: {
    runtimeScan: ReturnType<typeof vi.fn<RuntimeScan>>;
    publicScan: ReturnType<typeof vi.fn<PublicScan>>;
    source?: { id: string; name: string; gitUrl: string };
    instance?: InfraInstance | null;
  }) {
    const src = opts.source ?? SOURCE;
    const instance = opts.instance === undefined ? makeInfraInstance() : opts.instance;
    const runtimeClient: AgentRuntimeSkillsClient = {
      install: vi.fn(),
      uninstall: vi.fn(),
      listLocal: vi.fn(),
      publish: vi.fn(),
      scan: opts.runtimeScan,
    };
    const scanCache = async (gitUrl: string, scanner: (u: string) => Promise<Skill[]>) =>
      scanner(gitUrl);

    return createSkillsService({
      repo: { ...makeRepo(), get: async (id) => (id === src.id ? src : null) },
      instanceSkillsRepo: makeInstanceSkillsRepo(),
      instancesRepo: { get: vi.fn().mockResolvedValue(instance) } as unknown as InstancesRepository,
      agentsRepo: {
        get: vi.fn().mockResolvedValue({
          id: AGENT_ID,
          name: "a",
          spec: { skillPaths: ["/home/agent/.claude/skills/"] },
        }),
      } as unknown as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient,
      getAgentToken: async () => "token",
      owner: OWNER,
      scanSource: scanCache,
      invalidateScan: vi.fn(),
      scanPublic: opts.publicScan,
    });
  }

  it("uses the public archive path when it succeeds (no agent-runtime call)", async () => {
    const publicScan = vi.fn<PublicScan>().mockResolvedValue([
      { source: SOURCE.gitUrl, name: "adr", description: "", version: "sha", contentHash: "h" },
    ]);
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({ publicScan, runtimeScan });

    const result = await svc.listSkills(SOURCE.id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalledWith(SOURCE.gitUrl);
    expect(runtimeScan).not.toHaveBeenCalled();
    expect(result).toEqual([
      { source: SOURCE.gitUrl, name: "adr", description: "", version: "sha", contentHash: "h" },
    ]);
  });

  it("falls back to agent-runtime on PublicArchiveNotFoundError (private repo)", async () => {
    const publicScan = vi.fn<PublicScan>().mockRejectedValue(new PublicArchiveNotFoundError(SOURCE.gitUrl));
    const runtimeScan = vi.fn<RuntimeScan>().mockResolvedValue([
      { source: SOURCE.gitUrl, name: "secret", description: "priv", version: "sha", contentHash: "h" },
    ]);
    const svc = buildSvc({ publicScan, runtimeScan });

    const result = await svc.listSkills(SOURCE.id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalled();
    expect(runtimeScan).toHaveBeenCalledWith(INSTANCE_ID, "token", SOURCE.gitUrl);
    expect(result[0].name).toBe("secret");
  });

  it("does not require a running instance for a public scan", async () => {
    const publicScan = vi.fn<PublicScan>().mockResolvedValue([]);
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({
      publicScan,
      runtimeScan,
      instance: makeInfraInstance({ currentState: "hibernated" }),
    });

    await svc.listSkills(SOURCE.id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalled();
    expect(runtimeScan).not.toHaveBeenCalled();
  });

  it("throws PRECONDITION_FAILED when falling back to agent-runtime requires a running instance but it isn't", async () => {
    const publicScan = vi.fn<PublicScan>().mockRejectedValue(new PublicArchiveNotFoundError(SOURCE.gitUrl));
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({
      publicScan,
      runtimeScan,
      instance: makeInfraInstance({ currentState: "hibernated" }),
    });

    await expect(svc.listSkills(SOURCE.id, INSTANCE_ID)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(runtimeScan).not.toHaveBeenCalled();
  });

  it("rethrows non-404 public errors without calling agent-runtime", async () => {
    const publicScan = vi.fn<PublicScan>().mockRejectedValue(new Error("network blew up"));
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({ publicScan, runtimeScan });

    await expect(svc.listSkills(SOURCE.id, INSTANCE_ID)).rejects.toThrow(/network blew up/);
    expect(runtimeScan).not.toHaveBeenCalled();
  });

  it("scans a template:* source id by resolving it via the templates repo", async () => {
    const templateId = "tmpl-gw";
    const templateName = "Google Workspace";
    const templateUrl = "https://github.com/anthropics/google-workspace-skills";
    const publicScan = vi.fn<PublicScan>().mockResolvedValue([
      { source: templateUrl, name: "drive", description: "", version: "sha", contentHash: "h" },
    ]);
    const runtimeScan = vi.fn<RuntimeScan>();
    const scanCache = async (gitUrl: string, scanner: (u: string) => Promise<Skill[]>) =>
      scanner(gitUrl);
    const templatesRepo: TemplatesRepository = {
      list: async () => [],
      get: async (id) =>
        id === templateId
          ? {
              id: templateId,
              name: templateName,
              spec: {
                version: "humr.ai/v1",
                image: "x",
                skillSources: [{ name: "GW Skills", gitUrl: templateUrl }],
              },
            }
          : null,
      readSpec: async () => null,
    };
    const svc = createSkillsService({
      repo: {
        ...makeRepo(),
        get: async (id) => {
          if (id.startsWith("template:")) throw new Error("template:* must not hit the user repo");
          return null;
        },
      },
      instanceSkillsRepo: makeInstanceSkillsRepo(),
      instancesRepo: { get: vi.fn().mockResolvedValue(makeInfraInstance()) } as unknown as InstancesRepository,
      agentsRepo: { get: vi.fn().mockResolvedValue(makeAgent(["/home/agent/.claude/skills/"])) } as unknown as AgentsRepository,
      templatesRepo,
      seedSources: [],
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: vi.fn(),
        publish: vi.fn(),
        scan: runtimeScan,
      },
      getAgentToken: async () => "token",
      owner: OWNER,
      scanSource: scanCache,
      invalidateScan: vi.fn(),
      scanPublic: publicScan,
    });

    const id = templateSourceId(templateId, templateUrl);
    const result = await svc.listSkills(id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalledWith(templateUrl);
    expect(runtimeScan).not.toHaveBeenCalled();
    expect(result[0].name).toBe("drive");
  });
});

describe("skills-service getState (ghost reconciliation)", () => {
  function build(opts: {
    instance?: InfraInstance | null;
    initialInstalled?: SkillRef[];
    local?: Array<{ name: string; description: string; skillPath: string }>;
  }) {
    const infra = opts.instance === undefined ? makeInfraInstance() : opts.instance;
    const instancesGet = vi.fn().mockResolvedValue(infra);
    const runtimeClient: AgentRuntimeSkillsClient = {
      install: vi.fn(),
      uninstall: vi.fn(),
      listLocal: vi.fn().mockResolvedValue(opts.local ?? []),
      publish: vi.fn(),
      scan: vi.fn(),
    };
    const instanceSkillsRepo = makeInstanceSkillsRepo(opts.initialInstalled ?? []);
    const svc = createSkillsService({
      repo: makeRepo(),
      instanceSkillsRepo,
      instancesRepo: { get: instancesGet } as unknown as InstancesRepository,
      agentsRepo: {
        get: vi.fn().mockResolvedValue(makeAgent(["/home/agent/.claude/skills/"])),
      } as unknown as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });
    return { svc, instancesGet, runtimeClient, instanceSkillsRepo };
  }

  it("drops SkillRefs whose dirs are missing on disk and persists the cleanup", async () => {
    const initial: SkillRef[] = [
      { source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" },
      { source: SOURCE.gitUrl, name: "ghost", version: "v1", contentHash: "h1" },
    ];
    const { svc, instanceSkillsRepo } = build({
      initialInstalled: initial,
      local: [{ name: "adr", description: "", skillPath: "/home/agent/.claude/skills/" }],
    });

    const state = await svc.getState(INSTANCE_ID);

    expect(state.installed).toEqual([
      { source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" },
    ]);
    expect(state.standalone).toEqual([]);
    // Reconcile evicted the ghost
    expect(instanceSkillsRepo.state.installed).toEqual([
      { source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" },
    ]);
  });

  it("returns on-disk skills not tracked in installed-refs as standalone", async () => {
    const { svc, instanceSkillsRepo } = build({
      initialInstalled: [
        { source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" },
      ],
      local: [
        { name: "adr", description: "tracked", skillPath: "/home/agent/.claude/skills/" },
        { name: "my-draft", description: "new one", skillPath: "/home/agent/.claude/skills/" },
      ],
    });

    const state = await svc.getState(INSTANCE_ID);

    expect(state.installed.map((s) => s.name)).toEqual(["adr"]);
    expect(state.standalone.map((s) => s.name)).toEqual(["my-draft"]);
    // Nothing to evict
    expect(instanceSkillsRepo.state.installed).toHaveLength(1);
  });

  it("does not reconcile when the instance isn't running (safe during restart)", async () => {
    const initial: SkillRef[] = [
      { source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" },
    ];
    const { svc, runtimeClient, instanceSkillsRepo } = build({
      instance: makeInfraInstance({ currentState: "hibernated" }),
      initialInstalled: initial,
      local: [],
    });

    const state = await svc.getState(INSTANCE_ID);

    expect(state.installed).toEqual(initial);
    expect(state.standalone).toEqual([]);
    expect(runtimeClient.listLocal).not.toHaveBeenCalled();
    expect(instanceSkillsRepo.state.installed).toEqual(initial);
  });

  it("returns empty when the instance is missing", async () => {
    const { svc } = build({ instance: null });
    const state = await svc.getState("nope");
    expect(state).toEqual({ installed: [], standalone: [], instancePublishes: [] });
  });
});

describe("skills-service deleteSource", () => {
  it("translates SkillSourceProtectedError to a FORBIDDEN tRPC error", async () => {
    const del = vi.fn().mockRejectedValue(new SkillSourceProtectedError());
    const svc = createSkillsService({
      repo: { ...makeRepo(), delete: del },
      instanceSkillsRepo: makeInstanceSkillsRepo(),
      instancesRepo: { list: async () => [] } as unknown as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "agent-token-xyz",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await expect(svc.deleteSource("skill-src-seed-foo")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects deletion of synthesised template:* ids with FORBIDDEN", async () => {
    const del = vi.fn();
    const svc = createSkillsService({
      repo: { ...makeRepo(), delete: del },
      instanceSkillsRepo: makeInstanceSkillsRepo(),
      instancesRepo: {} as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await expect(svc.deleteSource("template:tmpl-x:abcdef012345")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("scrubs installed-skill rows that reference the deleted source's gitUrl", async () => {
    const otherUrl = "https://github.com/other/skills";
    const instA = makeInfraInstance({ id: "inst-A" });
    const instB = makeInfraInstance({ id: "inst-B" });
    const instancesList = vi.fn().mockResolvedValue([instA, instB]);
    const del = vi.fn().mockResolvedValue(undefined);
    const instanceSkillsRepo = makeInstanceSkillsRepo([
      { source: SOURCE.gitUrl, name: "adr", version: "v1" },
      { source: otherUrl, name: "other", version: "v1" },
    ]);

    const svc = createSkillsService({
      repo: { ...makeRepo(), delete: del },
      instanceSkillsRepo,
      instancesRepo: { list: instancesList } as unknown as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      seedSources: [],
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await svc.deleteSource(SOURCE.id);

    expect(del).toHaveBeenCalledWith(SOURCE.id, OWNER);
    expect(instanceSkillsRepo.removeBySource).toHaveBeenCalledWith(["inst-A", "inst-B"], SOURCE.gitUrl);
  });
});

describe("skills-service listSources", () => {
  const TEMPLATE_ID = "tmpl-gw";
  const TEMPLATE_NAME = "Google Workspace";
  const TEMPLATE_URL = "https://github.com/anthropics/google-workspace-skills";

  function build(opts: {
    userSources?: SkillSource[];
    template?: Template | null;
    templateId?: string;
    seeds?: SkillSourceSeed[];
  }) {
    const userSources = opts.userSources ?? [];
    const template = opts.template === undefined ? null : opts.template;
    const templateId = opts.templateId ?? (template?.id ?? null);

    const repo: SkillsRepository = {
      ...makeRepo(),
      list: async () => userSources,
    };

    const instancesRepo = {
      get: vi.fn().mockResolvedValue(makeInfraInstance()),
      list: async () => [],
    } as unknown as InstancesRepository;

    const agentsRepo = {
      get: vi.fn().mockResolvedValue({
        id: AGENT_ID,
        name: "a",
        templateId: templateId ?? undefined,
        spec: { version: "humr.ai/v1", name: "a", image: "x" },
      } as Agent),
    } as unknown as AgentsRepository;

    const templatesGet = vi.fn().mockImplementation(async (id: string) =>
      template && id === template.id ? template : null,
    );

    const templatesRepo: TemplatesRepository = {
      list: async () => [],
      get: templatesGet,
      readSpec: async () => null,
    };

    const svc = createSkillsService({
      repo,
      instanceSkillsRepo: makeInstanceSkillsRepo(),
      instancesRepo,
      agentsRepo,
      templatesRepo,
      seedSources: opts.seeds ?? [],
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    return { svc, templatesGet };
  }

  const TEMPLATE: Template = {
    id: TEMPLATE_ID,
    name: TEMPLATE_NAME,
    spec: {
      version: "humr.ai/v1",
      image: "x",
      skillSources: [
        { name: "GW Skills", gitUrl: TEMPLATE_URL },
      ],
    },
  };

  it("returns user-only sources when no instanceId is provided and no seeds configured", async () => {
    const { svc, templatesGet } = build({
      userSources: [{ id: "u-1", name: "Mine", gitUrl: "https://github.com/me/skills" }],
      template: TEMPLATE,
    });

    const out = await svc.listSources();
    expect(out.map((s) => s.gitUrl)).toEqual(["https://github.com/me/skills"]);
    expect(templatesGet).not.toHaveBeenCalled();
  });

  it("includes system seeds in listSources without an instanceId", async () => {
    const seeds: SkillSourceSeed[] = [
      { id: "skill-src-seed-cluster-ops", name: "Cluster Ops", gitUrl: "https://github.com/sys/c" },
    ];
    const { svc } = build({ seeds });
    const out = await svc.listSources();
    expect(out.find((s) => s.id === "skill-src-seed-cluster-ops")).toMatchObject({
      system: true,
      gitUrl: "https://github.com/sys/c",
    });
  });

  it("merges user + template sources with synthesised template ids and the Agent badge tag", async () => {
    const { svc } = build({
      userSources: [{ id: "u-1", name: "Mine", gitUrl: "https://github.com/me/skills" }],
      template: TEMPLATE,
    });

    const out = await svc.listSources(INSTANCE_ID);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "u-1", name: "Mine" });
    expect(out[1]).toMatchObject({
      id: templateSourceId(TEMPLATE_ID, TEMPLATE_URL),
      name: "GW Skills",
      gitUrl: TEMPLATE_URL,
      fromTemplate: { templateId: TEMPLATE_ID, templateName: TEMPLATE_NAME },
    });
    expect(out[1].system).toBeUndefined();
  });

  it("dedupes by gitUrl, with user winning over template for the same URL", async () => {
    const { svc } = build({
      userSources: [
        {
          id: "u-shadow",
          name: "My Workspace Skills",
          gitUrl: TEMPLATE_URL,
        },
      ],
      template: TEMPLATE,
    });

    const out = await svc.listSources(INSTANCE_ID);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("u-shadow");
    expect(out[0].fromTemplate).toBeUndefined();
  });

  it("falls back to user-only when the agent has no templateId", async () => {
    const { svc, templatesGet } = build({
      userSources: [{ id: "u-1", name: "Mine", gitUrl: "https://github.com/me/skills" }],
      template: null,
      templateId: undefined,
    });

    const out = await svc.listSources(INSTANCE_ID);

    expect(out.map((s) => s.id)).toEqual(["u-1"]);
    expect(templatesGet).not.toHaveBeenCalled();
  });

  it("sorts user → template → platform, alphabetical within each group", async () => {
    const userSources: SkillSource[] = [
      { id: "u-b", name: "Bravo", gitUrl: "https://github.com/u/b" },
      { id: "u-a", name: "alpha", gitUrl: "https://github.com/u/a" },
    ];
    const seeds: SkillSourceSeed[] = [
      { id: "skill-src-seed-cluster-ops", name: "Cluster Ops", gitUrl: "https://github.com/sys/c" },
    ];
    const template: Template = {
      id: TEMPLATE_ID,
      name: TEMPLATE_NAME,
      spec: {
        version: "humr.ai/v1",
        image: "x",
        skillSources: [
          { name: "Zeta", gitUrl: "https://github.com/t/z" },
          { name: "Alpha Team", gitUrl: "https://github.com/t/a" },
        ],
      },
    };
    const { svc } = build({ userSources, template, seeds });

    const out = await svc.listSources(INSTANCE_ID);

    expect(out.map((s) => s.name)).toEqual([
      "alpha",
      "Bravo",
      "Alpha Team",
      "Zeta",
      "Cluster Ops",
    ]);
  });

  it("resolves a synthesised template:* id via getSource (not a user-source lookup)", async () => {
    const { svc } = build({ template: TEMPLATE });
    const id = templateSourceId(TEMPLATE_ID, TEMPLATE_URL);

    const got = await svc.getSource(id);

    expect(got).toMatchObject({
      id,
      name: "GW Skills",
      gitUrl: TEMPLATE_URL,
      fromTemplate: { templateId: TEMPLATE_ID, templateName: TEMPLATE_NAME },
      canPublish: true,
    });
  });

  it("returns null from getSource when the template or the seed no longer exists", async () => {
    const { svc } = build({ template: null });
    const got = await svc.getSource("template:ghost:abcdef012345");
    expect(got).toBeNull();
  });

  it("resolves a system seed id via getSource", async () => {
    const seeds: SkillSourceSeed[] = [
      { id: "skill-src-seed-cluster-ops", name: "Cluster Ops", gitUrl: "https://github.com/sys/c" },
    ];
    const { svc } = build({ seeds });
    const got = await svc.getSource("skill-src-seed-cluster-ops");
    expect(got).toMatchObject({
      id: "skill-src-seed-cluster-ops",
      name: "Cluster Ops",
      gitUrl: "https://github.com/sys/c",
      system: true,
      canPublish: true,
    });
  });
});
