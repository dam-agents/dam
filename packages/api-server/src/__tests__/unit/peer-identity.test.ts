// TEST_OVERVIEW: the peer link's two verbs read an agent's workspace and open a connection to its sandbox, and the certificate on the other end is what decides who may ask. One authority signs every certificate in the install — including each gateway's, because an agent has to trust the gateway its own node hands it — so "the chain verifies" is not the question worth asking. This pins the one that is: whether a certificate is a node's.
import { describe, expect, it } from "vitest";
import { isNodeCertificate } from "../../modules/nodes/infrastructure/peer-link.js";

const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1";

describe("deciding whether a peer is a node", () => {
  it("admits a node's own certificate", () => {
    expect(
      isNodeCertificate({
        subjectaltname: "DNS:node-1, DNS:platform-node",
        ext_key_usage: [SERVER_AUTH, CLIENT_AUTH],
      }),
    ).toBe(true);
  });

  // TEST_SCENARIO: a gateway's certificate — same authority, issued for the hosts it terminates and for serving alone. It is the one every node hands out per agent, and the nearest thing in the install to a key for this door.
  it("refuses a gateway's certificate", () => {
    expect(
      isNodeCertificate({
        subjectaltname: "DNS:api.anthropic.com, DNS:github.com",
        ext_key_usage: [SERVER_AUTH],
      }),
    ).toBe(false);
  });

  // TEST_SCENARIO: the name alone is not the claim — anything signed by the install could ask to be issued it.
  it("refuses a certificate that claims the name but is not issued to use it", () => {
    expect(
      isNodeCertificate({
        subjectaltname: "DNS:platform-node",
        ext_key_usage: [SERVER_AUTH],
      }),
    ).toBe(false);
  });

  it("refuses a client certificate that is not a node's", () => {
    expect(
      isNodeCertificate({
        subjectaltname: "DNS:somebody-else",
        ext_key_usage: [CLIENT_AUTH],
      }),
    ).toBe(false);
  });

  it("refuses a certificate that says nothing at all", () => {
    expect(isNodeCertificate({})).toBe(false);
  });
});
