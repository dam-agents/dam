import { describe, expect, it } from "vitest";
import { defaultConfigPath } from "../modules/cli/infrastructure/config-path.js";

describe("defaultConfigPath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" })).toBe(
      "/tmp/xdg/dam/config.toml",
    );
  });

  it("falls through to $HOME/.config when XDG_CONFIG_HOME is empty", () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "" })).toMatch(
      /[/\\]\.config[/\\]dam[/\\]config\.toml$/,
    );
  });

  it("falls through to $HOME/.config when XDG_CONFIG_HOME is unset", () => {
    expect(defaultConfigPath({})).toMatch(
      /[/\\]\.config[/\\]dam[/\\]config\.toml$/,
    );
  });
});
