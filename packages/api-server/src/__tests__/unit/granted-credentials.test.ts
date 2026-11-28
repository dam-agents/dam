// TEST_OVERVIEW: what an Agent's gateway is told about the credentials of its grants. For each Connection the Agent holds now, the credential its grant names, if any; a grant that names none uses the Connection's own and is not listed. The list follows the order of the Connections, so the same grants always give the same list.
import { describe, expect, it } from "vitest";
import { grantedCredentialsOf } from "../../modules/connections/domain/granted-credentials.js";

describe("the credentials an Agent's gateway is told about", () => {
  // TEST_SCENARIO: an Agent holds three Connections and one grant names a credential. Only that grant is listed, with the credential it names.
  it("lists the grants that name a credential, and only those", () => {
    expect(
      grantedCredentialsOf(
        ["conn-github", "conn-dam", "conn-slack"],
        [{ connectionId: "conn-dam", credentialId: "cred-a" }],
      ),
    ).toEqual([{ connectionId: "conn-dam", credentialId: "cred-a" }]);
  });

  // TEST_SCENARIO: a stored credential for a Connection the Agent no longer holds, as while a grant is being removed, is left out, so the gateway is never told of a credential for a grant that is gone.
  it("leaves out a credential of a Connection the Agent no longer holds", () => {
    expect(
      grantedCredentialsOf(
        ["conn-github"],
        [{ connectionId: "conn-dam", credentialId: "cred-a" }],
      ),
    ).toEqual([]);
  });

  // TEST_SCENARIO: the stored rows come in any order. The list follows the Connections, so the gateway's revision moves only when a credential does.
  it("follows the order of the Connections", () => {
    const stored = [
      { connectionId: "conn-b", credentialId: "cred-b" },
      { connectionId: "conn-a", credentialId: "cred-a" },
    ];
    expect(grantedCredentialsOf(["conn-a", "conn-b"], stored)).toEqual([
      { connectionId: "conn-a", credentialId: "cred-a" },
      { connectionId: "conn-b", credentialId: "cred-b" },
    ]);
  });
});
