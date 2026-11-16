import type {
  AgentCreateInput,
  ChildEgress,
  ChildInheritance,
  HarnessFamily,
} from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: what every child Agent shares, whichever preset launches it: the Agent that launched it, which alone may open the link into its machine, what it takes of that Agent's connections (its grants are the ids given here: all the parent's for `parent`, the ones named for `subset`), and the platform's choices for an Agent no person set up: no default model provider of the owner's, and no egress preset of its own.
export interface ChildBase {
  parentAgentId: string;
  connectionsFrom: ChildInheritance["connectionsFrom"];
  connectionIds: string[];
  egress?: ChildEgress;
}

// UNIT_BOUNDARY_DESCRIPTION: a launch's egress choice as the child's inheritance records it: which rules decide its requests, and what an open or scoped child starts with.
function egressOf(
  egress: ChildEgress | undefined,
): Pick<ChildInheritance, "egressFrom" | "egressSeed"> {
  if (egress === undefined || egress === "parent")
    return { egressFrom: "parent" };
  if (egress === "open")
    return { egressFrom: "open", egressSeed: { rules: [] } };
  if ("open" in egress)
    return { egressFrom: "open", egressSeed: { rules: egress.open } };
  return { egressFrom: "scoped", egressSeed: { hosts: egress.scoped } };
}

// UNIT_BOUNDARY_DESCRIPTION: a sub-agent as spawn_subagent launches it: a throwaway target the sweep removes, its spend attributed to the root of its delegation chain, on the template or image and harness the spawn asked for, with the connections and provider the spawn resolved.
export interface SubAgentLaunch extends ChildBase {
  id: string;
  name: string;
  rootAgentId: string;
  templateId?: string;
  image?: string;
  harness?: HarnessFamily;
  setup: Pick<AgentCreateInput, "gitRepo" | "storage" | "env">;
  providerConnectionId?: string;
  // UNIT_BOUNDARY_DESCRIPTION: a sub-agent that sleeps between its runs (kept after a result, or a clean slate waiting for its first run with the files its driver put in) must not be taken by the Agent Sweep, which deletes a sleeping throwaway at once; its invocation removes it, at its keep expiry or its time limit.
  sleepsBetweenRuns?: boolean;
  hibernationTimeoutMin?: number;
}

// UNIT_BOUNDARY_DESCRIPTION: an Environment as create_environment launches it: no harness, a machine that sleeps after its idle timeout and lives until its own expiry, which injects a Connection's credential only into a request that names it.
export interface EnvironmentLaunch extends ChildBase {
  name: string;
  description: string;
  hibernationTimeoutMin: number;
  storage?: AgentCreateInput["storage"];
}

function childBase(
  launch: ChildBase,
): Pick<
  AgentCreateInput,
  | "linkFrom"
  | "noDefaultProvider"
  | "egressPreset"
  | "inheritance"
  | "connectionIds"
> {
  return {
    linkFrom: launch.parentAgentId,
    noDefaultProvider: true,
    egressPreset: "none",
    inheritance: {
      parentAgentId: launch.parentAgentId,
      connectionsFrom: launch.connectionsFrom,
      ...egressOf(launch.egress),
    },
    ...(launch.connectionsFrom !== "none" && launch.connectionIds.length
      ? { connectionIds: launch.connectionIds }
      : {}),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the one place a sub-agent's Agent create input is built, from the base every child shares.
export function subAgentCreateInput(launch: SubAgentLaunch): AgentCreateInput {
  return {
    ...childBase(launch),
    id: launch.id,
    name: launch.name,
    sweepable: !launch.sleepsBetweenRuns,
    ...(launch.hibernationTimeoutMin !== undefined && {
      hibernationTimeoutMin: launch.hibernationTimeoutMin,
    }),
    telemetryAttributionId: launch.rootAgentId,
    ...(launch.templateId ? { templateId: launch.templateId } : {}),
    ...(launch.image ? { image: launch.image } : {}),
    ...(launch.harness ? { harness: launch.harness } : {}),
    ...launch.setup,
    ...(launch.providerConnectionId
      ? { providerConnectionId: launch.providerConnectionId }
      : {}),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the one place an Environment's Agent create input is built, from the base every child shares.
export function environmentCreateInput(
  launch: EnvironmentLaunch,
): AgentCreateInput {
  return {
    ...childBase(launch),
    name: launch.name,
    description: launch.description,
    environmentOf: launch.parentAgentId,
    requireConnectionAddress: true,
    hibernationTimeoutMin: launch.hibernationTimeoutMin,
    ...(launch.storage ? { storage: launch.storage } : {}),
  };
}
