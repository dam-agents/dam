import { describe, expect, it } from "vitest";
import { knowledgeBaseTemplateIdSchema } from "api-server-api";
import { buildKnowledgeBaseInstallCommand } from "../../modules/knowledge-bases/domain/install-command.js";

describe("buildKnowledgeBaseInstallCommand", () => {
  it("maps every KB template id to a bootstrap command", () => {
    for (const id of knowledgeBaseTemplateIdSchema.options) {
      const command = buildKnowledgeBaseInstallCommand(id);
      expect(command).toContain("bootstrap.sh");
      expect(command).toContain(id === "llm-wiki" ? "llm-wiki" : "plain-wiki");
    }
  });

  it("selects the picked procedure", () => {
    expect(buildKnowledgeBaseInstallCommand("llm-wiki")).toContain(
      "llm-wiki-v2",
    );
    expect(buildKnowledgeBaseInstallCommand("plain-wiki")).toContain(
      "plain-wiki/main",
    );
  });
});
