import { describe, expect, it } from "vitest";
import { EXPERIMENT_SKILL_NAME } from "api-server-api";
import { buildExperimentInstallCommand } from "../../modules/experiments/domain/install-command.js";

describe("buildExperimentInstallCommand", () => {
  const command = buildExperimentInstallCommand();

  it("copies the kit out of the image rather than fetching it", () => {
    expect(command).toContain("/usr/local/share/dam-skills");
    expect(command).not.toContain("curl");
    expect(command).not.toContain("http");
  });

  it("installs the skill where the runtime's skill-ref driver scans", () => {
    expect(command).toContain(`"$HOME/.agents/skills/"`);
    expect(command).toContain(EXPERIMENT_SKILL_NAME);
  });

  it("installs the onboarding command before the skill", () => {
    const commandsAt = command.indexOf(".claude/commands/");
    const skillAt = command.lastIndexOf(EXPERIMENT_SKILL_NAME);
    expect(commandsAt).toBeGreaterThan(-1);
    expect(skillAt).toBeGreaterThan(commandsAt);
  });

  it("fails the run rather than half-installing", () => {
    expect(command).toContain("set -eu");
  });
});
