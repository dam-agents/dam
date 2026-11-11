// TEST_OVERVIEW: The Connection that lets an Agent drive this install as its owner says so wherever the owner meets it: the row of the Connection reads that it acts as them, the agent's Connections page warns that anyone who can drive it can act as them on the platform, and the editors and channel-bind flows say the same of the people they add. The template is never offered in the catalog, since only the platform mints it.
import { describe, expect, it } from "vitest";

import { getBrand } from "../../brand.js";
import { filterOfferedTemplates } from "../../modules/connections/internal-only.js";
import { connectionDetail } from "../../modules/connections/lib/connection-detail.js";
import {
  canGrantConnection,
  damActsAsYou,
  damAudienceSentence,
  damConnectionOffered,
  damGrantSentence,
  damHoldWarns,
  damPreGrantSentence,
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
    expect(filterOfferedTemplates([{ id: "dam" }], true, false)).toEqual([]);
    expect(filterOfferedTemplates([{ id: "dam" }], false, false)).toEqual([]);
    expect(
      filterOfferedTemplates([{ id: "dam" }], false, true).map((t) => t.id),
    ).toEqual(["dam"]);
  });

  // TEST_SCENARIO: the confirmation before a grant says what the grant gives away, and only for this Connection; an Agent that already holds it gets the standing sentence instead, and an unread library counts as holding it.
  it("warns before the grant, not only after", () => {
    expect(damPreGrantSentence("Acme", { templateId: "dam" })).toBe(
      "This lets the agent act as you on Acme, and anyone who can drive it too.",
    );
    expect(damPreGrantSentence("Acme", { templateId: "github" })).toBeNull();
    expect(damPreGrantSentence("Acme", undefined)).toBeNull();
    expect(damGrantSentence("Acme")).toContain("anyone who can drive it too");
    expect(damHoldWarns("held")).toBe(true);
    expect(damHoldWarns("unknown")).toBe(true);
    expect(damHoldWarns("not-held")).toBe(false);
    expect(damConnectionOffered({ damConnection: true })).toBe(true);
    expect(damConnectionOffered({ damConnection: false })).toBe(false);
    expect(damConnectionOffered(undefined)).toBe(false);
    expect(canGrantConnection(true, { templateId: "dam" })).toBe(true);
    expect(canGrantConnection(false, { templateId: "dam" })).toBe(false);
    expect(canGrantConnection(false, { templateId: "github" })).toBe(true);
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
