import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretRef } from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Private-registry credentials for an agent's own
 * image. They live in the install's secret store, not on a node, because the
 * node that pulls the image is not necessarily the node the agent was created
 * on. A node materializes the docker config format the pull needs into the
 * agent's own directory, one directory per agent so a pull only ever sees the
 * credential for the image it is pulling, and never mounts it into the sandbox.
 *
 * The agent id is carried on the secret's labels as well as the ref on its
 * spec: the ref goes with the agent record, so an orphan sweep that runs after
 * the record is gone has nothing else to recognise the secret by.
 *
 * `materialize` writes the docker config a pull reads and returns the
 * directory holding it.
 */
const PURPOSE = "registry-auth";
const AGENT_LABEL = "agentId";

export interface RegistryCredential {
  server: string;
  username: string;
  password: string;
}

export interface AgentRegistryAuthPort {
  create(
    agentId: string,
    ownerSub: string,
    cred: RegistryCredential,
  ): Promise<SecretRef>;
  delete(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
  materialize(ref: SecretRef, dir: string): Promise<string>;
}

export function createAgentRegistryAuthPort(
  secrets: SecretStore,
): AgentRegistryAuthPort {
  const refsFor = async (agentId: string) =>
    (await secrets.listByPurpose(PURPOSE)).filter(
      (s) => s.metadata.extraLabels?.[AGENT_LABEL] === agentId,
    );

  return {
    async create(agentId, ownerSub, cred) {
      const meta = {
        owner: ownerSub,
        purpose: PURPOSE,
        extraLabels: { [AGENT_LABEL]: agentId },
      };
      const ref = secrets.mintRef(meta);
      await secrets.put(ref, { ...cred }, meta);
      return ref;
    },

    async delete(agentId) {
      for (const { ref } of await refsFor(agentId)) await secrets.delete(ref);
    },

    async listAgentIds() {
      const all = await secrets.listByPurpose(PURPOSE);
      return all.flatMap((s) => {
        const id = s.metadata.extraLabels?.[AGENT_LABEL];
        return id ? [id] : [];
      });
    },

    async materialize(ref, dir) {
      const fields = await secrets.get(ref);
      if (!fields?.server) {
        throw new Error(`registry credential ${ref.path} is missing or empty`);
      }
      const auth = Buffer.from(
        `${fields.username ?? ""}:${fields.password ?? ""}`,
      ).toString("base64");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(
        join(dir, "config.json"),
        JSON.stringify({ auths: { [fields.server]: { auth } } }),
        { mode: 0o600 },
      );
      return dir;
    },
  };
}
