import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SavedSignIn {
  host: string;
  accessToken?: string;
  expiresAt?: string;
}

export async function writeSavedSignIns(
  home: string,
  signIns: ReadonlyArray<SavedSignIn>,
  activeServer?: string,
): Promise<void> {
  const stateDir = join(home, "state", "dam");
  await mkdir(stateDir, { recursive: true });
  const tables = signIns.map((s) =>
    [
      `[hosts."${s.host}"]`,
      'issuer = "http://keycloak.test/realms/platform"',
      `username = "user-of-${new URL(s.host).hostname}"`,
      'sub = "sub"',
      'cli_client_id = "platform-cli"',
      `access_token = "${s.accessToken ?? "saved-access"}"`,
      'refresh_token = "saved-refresh"',
      `expires_at = "${s.expiresAt ?? "2099-01-01T00:00:00.000Z"}"`,
      "",
    ].join("\n"),
  );
  await writeFile(join(stateDir, "auth.toml"), tables.join("\n"), {
    mode: 0o600,
  });
  if (activeServer !== undefined) {
    const configDir = join(home, "config", "dam");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "config.toml"),
      `server = "${activeServer}"\n`,
    );
  }
}

export function signInEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    XDG_STATE_HOME: join(home, "state"),
    XDG_CONFIG_HOME: join(home, "config"),
    PATH: process.env.PATH ?? "",
  };
}
