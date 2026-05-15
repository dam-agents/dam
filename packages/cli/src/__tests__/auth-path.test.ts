import { describe, expect, it } from "vitest";
import { defaultAuthPath } from "../modules/auth/infrastructure/auth-path.js";

describe("defaultAuthPath", () => {
  // The whole point of the test is to lock in the XDG empty-string-is-unset
  // rule (XDG Base Directory Specification §"Basics"). Anything else here
  // would be testing node:path.join.
  it.each([
    {
      label: "XDG_STATE_HOME set → honored",
      env: { XDG_STATE_HOME: "/tmp/xdg-state" },
      expect: "/tmp/xdg-state/dam/auth.toml",
    },
    {
      label: "XDG_STATE_HOME empty → fall back to $HOME/.local/state",
      env: { XDG_STATE_HOME: "" },
      expect: /[/\\]\.local[/\\]state[/\\]dam[/\\]auth\.toml$/,
    },
    {
      label: "XDG_STATE_HOME unset → fall back to $HOME/.local/state",
      env: {},
      expect: /[/\\]\.local[/\\]state[/\\]dam[/\\]auth\.toml$/,
    },
  ])("$label", ({ env, expect: e }) => {
    const result = defaultAuthPath(env);
    if (typeof e === "string") expect(result).toBe(e);
    else expect(result).toMatch(e);
  });
});
