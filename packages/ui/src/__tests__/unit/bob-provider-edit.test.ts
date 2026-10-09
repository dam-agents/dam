// TEST_OVERVIEW: editing a Bob Shell provider changes its Advanced pins without re-entering the key. The edit form accepts an empty key, and the update it sends carries the pins, with the key only when one was typed.
import { describe, expect, it } from "vitest";

import { bobCredentialSchema } from "../../modules/providers/components/bob/form.js";
import { bobUpdateInput } from "../../modules/providers/components/provider-item.js";

const pinsOnly = {
  value: "",
  model: "premium-shell",
  agentId: "",
  teamId: "team-2",
  maxCost: "",
  chatMode: "",
};

describe("editing a Bob provider", () => {
  it("accepts an empty key on edit but not on connect", () => {
    expect(bobCredentialSchema("edit").safeParse(pinsOnly).success).toBe(true);
    expect(bobCredentialSchema("wizard").safeParse(pinsOnly).success).toBe(
      false,
    );
  });

  it("sends the pins, and the key only when one was typed", () => {
    const pins = { model: "premium-shell", teamId: "team-2" };
    expect(bobUpdateInput("conn-1", "", pins)).toEqual({
      id: "conn-1",
      configInputs: { model: "premium-shell", teamId: "team-2" },
    });
    expect(bobUpdateInput("conn-1", "bob-key", pins)).toEqual({
      id: "conn-1",
      configInputs: { model: "premium-shell", teamId: "team-2" },
      value: "bob-key",
    });
  });
});
