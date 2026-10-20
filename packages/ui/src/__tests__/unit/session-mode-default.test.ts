// TEST_OVERVIEW: the value the session settings picker shows for a mode the owner has not picked. The runtime derives that mode from the session's model, so the picker shows the same mode the session really starts in — a model that cannot use the catalog's default shows the mode the catalog allows for it — while a mode configured for the harness, or one the owner picked, is shown as it is.
import type {
  HarnessCapability,
  HarnessConfigCatalog,
} from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import { settingDefaults } from "../../modules/sessions/lib/session-settings.js";

const CATALOG: HarnessConfigCatalog = {
  options: [
    { id: "model", name: "Model", category: "model", choices: [] },
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      default: "auto",
      choices: [
        { value: "auto", name: "Auto" },
        { value: "default", name: "Ask for approvals" },
      ],
    },
  ],
  modelConstraints: { haiku: { mode: ["default"] } },
};

const capability = {
  name: "claude-code",
  harnessConfigCatalog: CATALOG,
  sessionSettings: ["model", "mode"],
  derivedStartMode: ["mode"],
} as unknown as HarnessCapability;

const configured = { mode: null, model: null, configOptions: {} };

describe("session mode shown before the owner picks one", () => {
  it("shows the mode the catalog defaults to for the session's model", () => {
    expect(
      settingDefaults(capability, configured, "ibm/claude-opus-4-5").mode,
    ).toBe("auto");
  });

  it("shows the mode the model allows where it cannot use the default", () => {
    expect(
      settingDefaults(capability, configured, "ibm/claude-haiku-4-5").mode,
    ).toBe("default");
  });

  it("shows the mode the model the agent's file names allows", () => {
    expect(
      settingDefaults(
        capability,
        { ...configured, model: "ibm/claude-haiku-4-5" },
        null,
      ).mode,
    ).toBe("default");
  });

  it("shows the manifest default for a harness that derives no start mode", () => {
    expect(
      settingDefaults(
        { ...capability, derivedStartMode: undefined },
        configured,
        "ibm/claude-haiku-4-5",
      ).mode,
    ).toBe("auto");
  });

  it("shows a mode the agent's config file names as it is", () => {
    expect(
      settingDefaults(
        capability,
        { ...configured, mode: "default" },
        "ibm/claude-opus-4-5",
      ).mode,
    ).toBe("default");
  });
});
