import { describe, expect, it } from "vitest";
import { EXPERIMENT_SKILL_NAME } from "api-server-api";
import { buildExperimentInstallCommand } from "../../modules/experiments/domain/install-command.js";

describe("buildExperimentInstallCommand", () => {
  const command = buildExperimentInstallCommand();

  it("copies the kit out of the image rather than fetching it", () => {
    expect(command).toContain("/usr/local/share/dam-skills");
    // Unlike a Knowledge Base's bootstrap, nothing is downloaded — the content
    // ships with the agent image, so there is no unattended fetch to trust.
    expect(command).not.toContain("curl");
    expect(command).not.toContain("http");
  });

  it("installs the skill where the runtime's skill-ref driver scans", () => {
    // $HOME/.agents/skills is the manifest's skill path, which is what makes
    // the skill show up in skills.state.standalone.
    expect(command).toContain(`"$HOME/.agents/skills/"`);
    expect(command).toContain(EXPERIMENT_SKILL_NAME);
  });

  it("installs the onboarding command before the skill", () => {
    // Load-bearing order: the UI gates the hidden /experiment-onboard greeting
    // on the skill appearing, so the skill must land last for its presence to
    // imply the command already exists.
    const commandsAt = command.indexOf(".claude/commands/");
    const skillAt = command.lastIndexOf(EXPERIMENT_SKILL_NAME);
    expect(commandsAt).toBeGreaterThan(-1);
    expect(skillAt).toBeGreaterThan(commandsAt);
  });

  it("fails the run rather than half-installing", () => {
    // Without set -e a failed copy would still exit 0, letting the in-pod
    // sentinel mark the install done and never retry.
    expect(command).toContain("set -eu");
  });
});
