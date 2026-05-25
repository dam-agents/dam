import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ok, type SkillInstallInput } from "agent-runtime-api";
import { createSkillInstallPlugin } from "../../modules/runtime-channel/drivers/skill-install-plugin.js";

const fixtureDirs: string[] = [];
function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "skill-install-"));
  fixtureDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (fixtureDirs.length) {
    const d = fixtureDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function ctx(agentHome: string) {
  return {
    agentHome,
    pluginStateDir: join(agentHome, ".state"),
    log: vi.fn(),
  };
}

describe("skill-install plugin", () => {
  it("refuses to bind a kind other than 'skill-ref'", () => {
    const plugin = createSkillInstallPlugin({
      install: async () => ok({ contentHash: "h" }),
    });
    expect(() =>
      plugin.bind("file", { impl: "skill-install", paths: ["x"] }),
    ).toThrow(/does not handle kind/);
  });

  it("validates binding config at bind time", () => {
    const plugin = createSkillInstallPlugin({
      install: async () => ok({ contentHash: "h" }),
    });
    expect(() => plugin.bind("skill-ref", { impl: "skill-install" })).toThrow(
      /invalid binding/,
    );
  });

  it("calls the injected install for every desired skill, with sourceUrl-shaped input", async () => {
    const home = mkTmp();
    const seen: SkillInstallInput[] = [];
    const plugin = createSkillInstallPlugin({
      install: async (input) => {
        seen.push(input);
        return ok({ contentHash: "h" });
      },
    });
    const handler = plugin.bind("skill-ref", {
      impl: "skill-install",
      paths: ["$HOME/.agents/skills"],
    });
    await handler(
      [
        {
          kind: "skill-ref",
          sourceUrl: "https://github.com/foo/bar.git",
          name: "skill-a",
          version: "abc1234",
        },
      ],
      ctx(home),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.sourceUrl).toBe("https://github.com/foo/bar.git");
    expect(seen[0]!.name).toBe("skill-a");
    expect(seen[0]!.version).toBe("abc1234");
    expect(seen[0]!.skillPaths).toEqual([join(home, ".agents/skills")]);
  });

  it("snapshot-reconciles: removes directories that aren't in the desired set", async () => {
    const home = mkTmp();
    // Pre-populate a "ghost" skill directory under the configured path.
    const skillRoot = join(home, ".agents/skills");
    mkdirSync(join(skillRoot, "ghost"), { recursive: true });
    expect(existsSync(join(skillRoot, "ghost"))).toBe(true);

    const plugin = createSkillInstallPlugin({
      install: async () => ok({ contentHash: "h" }),
    });
    const handler = plugin.bind("skill-ref", {
      impl: "skill-install",
      paths: ["$HOME/.agents/skills"],
    });
    // Empty desired set — the ghost should be reaped.
    await handler([], ctx(home));
    expect(existsSync(join(skillRoot, "ghost"))).toBe(false);
  });
});
