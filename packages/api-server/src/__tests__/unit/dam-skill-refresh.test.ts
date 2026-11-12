// TEST_OVERVIEW: the skill a DAM Connection carries is the platform's own file, and
// TEST_OVERVIEW: a Connection stores the contributions it was made with — so an
// TEST_OVERVIEW: install that upgrades keeps teaching every Agent the old skill
// TEST_OVERVIEW: unless the stored file is read as the install writes it now. The
// TEST_OVERVIEW: state is built from the current text, with nothing written, and
// TEST_OVERVIEW: every other contribution, and every other Connection, is untouched.
import { DAM_TEMPLATE_ID } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  currentDamSkill,
  damSkill,
} from "../../modules/connections/domain/dam-connection.js";

const skillPath = "$HOME/.agents/skills/dam/SKILL.md";

const stored = [
  {
    kind: "env" as const,
    name: "DAM_SERVER",
    placeholder: "https://dam.example",
  },
  {
    kind: "file" as const,
    path: skillPath,
    format: "text" as const,
    mergeMode: "overwrite" as const,
    content: "# an old skill\n",
  },
  { kind: "egress-allow" as const, host: "dam.example", pathPattern: "/api/*" },
];

describe("the skill a stored DAM Connection carries", () => {
  // TEST_SCENARIO: a Connection made before the skill learned a command has the old text stored; the state is built with the install's current skill, so the Agent reads the new command.
  it("is read as the install writes it now", () => {
    const now = currentDamSkill(DAM_TEMPLATE_ID, stored, "DAM");
    const file = now.find((c) => c.kind === "file");
    expect(file).toMatchObject({ path: skillPath, content: damSkill("DAM") });
    expect(file).not.toMatchObject({ content: "# an old skill\n" });
    expect(now).toHaveLength(stored.length);
  });

  // TEST_SCENARIO: nothing else is touched: another Connection's file keeps what it stored, and the DAM Connection's other contributions are as they were.
  it("leaves every other contribution alone", () => {
    const other = [
      {
        kind: "file" as const,
        path: "another.md",
        format: "text" as const,
        mergeMode: "overwrite" as const,
        content: "kept",
      },
    ];
    expect(currentDamSkill("some-other-template", other, "DAM")).toEqual(other);
    const now = currentDamSkill(DAM_TEMPLATE_ID, stored, "DAM");
    expect(now.filter((c) => c.kind !== "file")).toEqual(
      stored.filter((c) => c.kind !== "file"),
    );
  });

  // TEST_SCENARIO: the skill is the install's own words, so it changes when the brand does.
  it("follows the install's brand", () => {
    const file = currentDamSkill(DAM_TEMPLATE_ID, stored, "Platform").find(
      (c) => c.kind === "file",
    );
    expect(file).toMatchObject({ content: damSkill("Platform") });
  });
});

describe("what the skill says about dam run", () => {
  // TEST_SCENARIO: `dam run` works from inside an Agent now, so the skill teaches it and no longer says it does not work here: the skill and the CLI agree.
  it("teaches dam run and never says it fails here", () => {
    const skill = damSkill("DAM");
    expect(skill).toContain('dam run <agent> -p "<prompt>" --json');
    expect(skill).not.toMatch(/do not work here/);
  });
});
