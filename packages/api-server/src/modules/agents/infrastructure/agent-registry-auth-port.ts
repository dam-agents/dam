import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Private-registry credentials for an agent's own
 * image, in the docker config format the container runtime already reads. One
 * directory per agent, so a pull only ever sees the credential for the image it
 * is pulling; never mounted into the sandbox.
 */
export interface RegistryCredential {
  server: string;
  username: string;
  password: string;
}

export interface AgentRegistryAuthPort {
  configDir(agentId: string): string;
  create(
    agentId: string,
    ownerSub: string,
    cred: RegistryCredential,
  ): Promise<void>;
  delete(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

function buildDockerConfigJson(cred: RegistryCredential): string {
  const auth = Buffer.from(`${cred.username}:${cred.password}`).toString(
    "base64",
  );
  return JSON.stringify({ auths: { [cred.server]: { auth } } });
}

export function createAgentRegistryAuthPort(
  root: string,
): AgentRegistryAuthPort {
  const configDir = (agentId: string) => join(root, agentId);

  return {
    configDir,

    async create(agentId, _ownerSub, cred) {
      await mkdir(configDir(agentId), { recursive: true, mode: 0o700 });
      await writeFile(
        join(configDir(agentId), "config.json"),
        buildDockerConfigJson(cred),
        { mode: 0o600 },
      );
    },

    async delete(agentId) {
      await rm(configDir(agentId), { recursive: true, force: true });
    },

    async listAgentIds() {
      try {
        return await readdir(root);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
