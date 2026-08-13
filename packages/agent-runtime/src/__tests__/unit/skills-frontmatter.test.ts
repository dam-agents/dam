import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  ensureFrontmatterName,
  parseFrontmatter,
} from "../../modules/skills/domain/frontmatter.js";
import { makeSkillSlug } from "../../modules/skills/domain/skill-name.js";

function yamlName(content: string): unknown {
  const body = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  return (parseYaml(body) as { name?: unknown } | null)?.name;
}

describe("ensureFrontmatterName", () => {
  const cases: [label: string, source: string][] = [
    ["plain scalar", "---\nname: Old\ndescription: d\n---\n\nBody\n"],
    ["literal block scalar", "---\nname: |\n  Multi\n  Line\n---\n\nBody\n"],
    ["folded block scalar", "---\nname: >\n  Multi\n  Line\n---\n\nBody\n"],
    ["no name key", "---\ndescription: d\n---\n\nBody\n"],
    ["no frontmatter", "# Just markdown\n"],
    ["crlf", "---\r\nname: Old\r\ndescription: d\r\n---\r\n\r\nBody\r\n"],
  ];

  it.each(cases)(
    "%s — a real YAML parser sees the confirmed name",
    (_, src) => {
      expect(yamlName(ensureFrontmatterName(src, "New Name"))).toBe("New Name");
    },
  );

  it.each(cases)("%s — parseFrontmatter agrees with YAML", (_, src) => {
    const out = ensureFrontmatterName(src, "New Name");
    expect(parseFrontmatter(out).name).toBe(yamlName(out));
  });

  it("quotes a name that would otherwise break the block", () => {
    const out = ensureFrontmatterName("---\nname: Old\n---\n", "Weird: #name");
    expect(yamlName(out)).toBe("Weird: #name");
    expect(parseFrontmatter(out).name).toBe("Weird: #name");
  });

  it("leaves sibling keys and the body untouched", () => {
    const src =
      "---\nname: |\n  Multi\ndescription: |\n  one\n  two\n---\n\nB\n";
    const out = ensureFrontmatterName(src, "New Name");
    expect(parseFrontmatter(out).description).toBe("one\ntwo");
    expect(out.endsWith("---\n\nB\n")).toBe(true);
  });
});

describe("makeSkillSlug", () => {
  it("collapses spaces and underscores to the same slug", () => {
    const a = makeSkillSlug("My Skill");
    const b = makeSkillSlug("my_skill");
    expect(a.ok && b.ok && a.value === b.value).toBe(true);
  });

  it("rejects a name with no slug-safe characters", () => {
    expect(makeSkillSlug("🙂").ok).toBe(false);
  });
});
