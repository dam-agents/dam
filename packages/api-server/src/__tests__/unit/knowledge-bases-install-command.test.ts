import { describe, expect, it } from "vitest";
import {
  kbHarnessFamilySchema,
  knowledgeBaseTemplateIdSchema,
} from "api-server-api";
import { buildKnowledgeBaseInstallCommand } from "../../modules/knowledge-bases/domain/install-command.js";

describe("buildKnowledgeBaseInstallCommand", () => {
  it("maps every KB template id to a bootstrap command", () => {
    for (const id of knowledgeBaseTemplateIdSchema.options) {
      const command = buildKnowledgeBaseInstallCommand(id, "claude-code");
      expect(command).toContain("bootstrap.sh");
      expect(command).toContain(id === "llm-wiki" ? "llm-wiki" : "plain-wiki");
      expect(command).toContain("set -o pipefail");
    }
  });

  it("selects the picked procedure", () => {
    expect(
      buildKnowledgeBaseInstallCommand("llm-wiki", "claude-code"),
    ).toContain("llm-wiki-v2");
    expect(
      buildKnowledgeBaseInstallCommand("plain-wiki", "claude-code"),
    ).toContain("plain-wiki/main");
  });

  // TEST_SCENARIO: both bootstraps wire the harness themselves, driven by a
  // TEST_SCENARIO: template-specific env var — the platform names the family it knows from
  // TEST_SCENARIO: the harness template and never appends shell of its own.
  it("hands the harness family to each bootstrap as its harness env var", () => {
    const envNames = {
      "llm-wiki": "LLM_WIKI_HARNESS",
      "plain-wiki": "PLAIN_WIKI_HARNESS",
    } as const;
    for (const id of knowledgeBaseTemplateIdSchema.options) {
      for (const family of kbHarnessFamilySchema.options) {
        const command = buildKnowledgeBaseInstallCommand(id, family);
        expect(command).toMatch(
          new RegExp(`bootstrap\\.sh \\| ${envNames[id]}=${family} bash$`),
        );
      }
    }
  });

  // TEST_SCENARIO: a template with no declared family (custom image, the e2e mock
  // TEST_SCENARIO: harness) must keep today's bare command, leaving the bootstrap to detect
  // TEST_SCENARIO: the harness itself.
  it("stays silent about the harness when the family is unknown", () => {
    for (const id of knowledgeBaseTemplateIdSchema.options) {
      const command = buildKnowledgeBaseInstallCommand(id, undefined);
      expect(command).not.toContain("_HARNESS");
      expect(command).toMatch(/bootstrap\.sh \| bash$/);
    }
  });
});
