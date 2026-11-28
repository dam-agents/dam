// TEST_OVERVIEW: what an Agent's gateway is told about the derived credentials of its scoped grants. For each Connection the Agent holds now, the key of the derived credential its scope matches, if the grant has a scope; a grant with none uses the Connection's own credential and is not listed. The list follows the order of the Connections, so the same grants always give the same list.
import { describe, expect, it } from "vitest";
import { derivedCredentialsOf } from "../../modules/connections/domain/derived-credentials.js";

describe("the derived credentials an Agent's gateway is told about", () => {
  // TEST_SCENARIO: an Agent holds three Connections and one grant has a scope. Only that grant is listed, with the key of its derived credential.
  it("lists the scoped grants, and only those", () => {
    expect(
      derivedCredentialsOf(
        ["conn-github", "conn-dam", "conn-slack"],
        [{ connectionId: "conn-dam", key: "agent-a" }],
      ),
    ).toEqual([{ connectionId: "conn-dam", key: "agent-a" }]);
  });

  // TEST_SCENARIO: a stored key for a Connection the Agent no longer holds, as while a grant is being removed, is left out, so the gateway is never told of a derived credential for a grant that is gone.
  it("leaves out a key of a Connection the Agent no longer holds", () => {
    expect(
      derivedCredentialsOf(
        ["conn-github"],
        [{ connectionId: "conn-dam", key: "agent-a" }],
      ),
    ).toEqual([]);
  });

  // TEST_SCENARIO: the stored rows come in any order. The list follows the Connections, so the gateway's revision moves only when a key does.
  it("follows the order of the Connections", () => {
    const stored = [
      { connectionId: "conn-b", key: "key-b" },
      { connectionId: "conn-a", key: "key-a" },
    ];
    expect(derivedCredentialsOf(["conn-a", "conn-b"], stored)).toEqual([
      { connectionId: "conn-a", key: "key-a" },
      { connectionId: "conn-b", key: "key-b" },
    ]);
  });
});
