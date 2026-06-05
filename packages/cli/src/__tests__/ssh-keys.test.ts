import { describe, expect, it } from "vitest";
import { sshPaths } from "../modules/ssh/infrastructure/ssh-keys.js";

describe("sshPaths", () => {
  // Locks the XDG empty-string-is-unset rule and the fixed key-file names the
  // ProxyCommand depends on.
  it("honors XDG_STATE_HOME", () => {
    const p = sshPaths({ XDG_STATE_HOME: "/tmp/xdg-state" });
    expect(p.dir).toBe("/tmp/xdg-state/dam/ssh");
    expect(p.privateKey).toBe("/tmp/xdg-state/dam/ssh/id_ed25519");
    expect(p.publicKey).toBe("/tmp/xdg-state/dam/ssh/id_ed25519.pub");
  });

  it.each([{ XDG_STATE_HOME: "" }, {}])(
    "falls back to ~/.local/state when XDG_STATE_HOME is empty/unset",
    (env) => {
      expect(sshPaths(env).privateKey).toMatch(
        /[/\\]\.local[/\\]state[/\\]dam[/\\]ssh[/\\]id_ed25519$/,
      );
    },
  );
});
