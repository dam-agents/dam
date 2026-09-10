import { exec } from "./exec.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Resolves the account the paired gateways run as,
 * by name at boot rather than by a configured number. The account is created by
 * the install, and a stale number in a config file would hand an agent's
 * credentials to whoever holds that id now.
 */
export async function resolveGatewayUser(
  name: string,
): Promise<{ uid: number; gid: number }> {
  const [uid, gid] = await Promise.all([
    exec("id", ["-u", name]),
    exec("id", ["-g", name]),
  ]).catch(() => {
    throw new Error(
      `gateway user ${name} does not exist — the install creates it, and no agent can start without it`,
    );
  });
  return { uid: Number(uid.trim()), gid: Number(gid.trim()) };
}
