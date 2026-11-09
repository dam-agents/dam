// TEST_OVERVIEW: The Connection that lets an Agent drive this install as its owner says so wherever the owner meets it: the row of the Connection reads that it acts as them, the agent's Connections page warns that anyone who can drive it can act as them on the platform, and the editors and channel-bind flows say the same of the people they add. The template is never offered in the catalog, since only the platform mints it.
import { describe, expect, it } from "vitest";

import { getBrand } from "../../brand.js";
import { filterOfferedTemplates } from "../../modules/connections/internal-only.js";
import { connectionDetail } from "../../modules/connections/lib/connection-detail.js";
import {
  damActsAsYou,
  damAudienceSentence,
  isDamConnection,
} from "../../modules/connections/lib/dam-connection.js";

describe("the DAM connection", () => {
  // TEST_SCENARIO: the Connection is named by its template, and its row says whose access it carries.
  it("reads as acting as the owner, and is never offered in the catalog", () => {
    const connection = {
      templateId: "dam",
      authKind: "header" as const,
    };
    expect(isDamConnection(connection)).toBe(true);
    expect(isDamConnection({ templateId: "github" })).toBe(false);
    expect(connectionDetail(connection).account).toBe(
      damActsAsYou(getBrand().name),
    );
    expect(connectionDetail(connection).account).toMatch(/^Acts as you on /);
    expect(filterOfferedTemplates([{ id: "dam" }], true)).toEqual([]);
    expect(filterOfferedTemplates([{ id: "dam" }], false)).toEqual([]);
  });

  // TEST_SCENARIO: whoever can steer the agent acts as the owner, so each flow names who that is.
  it("names its audience in one sentence", () => {
    expect(damAudienceSentence("Acme", "anyone you add as an editor")).toBe(
      "This agent holds the Acme connection, so anyone you add as an editor can act as you on Acme.",
    );
    expect(damAudienceSentence("Acme", "anyone in this chat")).toContain(
      "anyone in this chat can act as you on Acme",
    );
  });
});
