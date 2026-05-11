import { describe, expect, it } from "vitest";
import { defaultAuthPath } from "../modules/auth/infrastructure/auth-path.js";

describe("defaultAuthPath", () => {
  it("uses XDG_STATE_HOME when set", () => {
    expect(defaultAuthPath({ XDG_STATE_HOME: "/tmp/xdg-state" })).toBe(
      "/tmp/xdg-state/dam/auth.toml",
    );
  });

  it("falls through to $HOME/.local/state when XDG_STATE_HOME is empty", () => {
    // Empty string is treated as unset per the XDG spec §"Basics".
    expect(defaultAuthPath({ XDG_STATE_HOME: "" })).toMatch(
      /[/\\]\.local[/\\]state[/\\]dam[/\\]auth\.toml$/,
    );
  });

  it("falls through to $HOME/.local/state when XDG_STATE_HOME is unset", () => {
    // os.homedir() ignores process.env.HOME on some platforms, so assert
    // structural shape rather than the absolute path.
    expect(defaultAuthPath({})).toMatch(
      /[/\\]\.local[/\\]state[/\\]dam[/\\]auth\.toml$/,
    );
  });
});
