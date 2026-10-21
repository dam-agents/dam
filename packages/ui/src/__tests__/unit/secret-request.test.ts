// TEST_OVERVIEW: the page a user types a connection secret on reads its request from the link, says where the secret goes in plain terms, and tells a user who opened another user's link not to enter a secret there.
import { describe, expect, it } from "vitest";

import {
  destinationDetail,
  destinationLabel,
  readSecretRequestId,
  secretRequestErrorCopy,
} from "../../modules/connections/lib/secret-request.js";

describe("secret request page", () => {
  it("reads the request id from the link", () => {
    expect(readSecretRequestId("?request=abc_-1")).toBe("abc_-1");
    expect(readSecretRequestId("?request=")).toBeNull();
    expect(readSecretRequestId("")).toBeNull();
  });

  // TEST_SCENARIO: the user sees the exact header the gateway sends, with the secret's place marked, and the port when the host has one.
  it("shows the header with the secret's place marked", () => {
    const d = {
      host: "api.github.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    };
    expect(destinationLabel(d)).toBe("api.github.com");
    expect(destinationDetail(d)).toBe("Authorization: Bearer <secret>");
    expect(destinationLabel({ host: "k8s.example", port: 6443 })).toBe(
      "k8s.example:6443",
    );
    expect(destinationDetail({ host: "s3.example", signed: true })).toBe(
      "requests signed with the key pair",
    );
  });

  // TEST_SCENARIO: a link made on another account is the phishing case, so its copy warns the user off rather than only saying the link failed.
  it("warns off a link from another user", () => {
    expect(secretRequestErrorCopy("FORBIDDEN").hint).toMatch(
      /Never enter a secret on a link someone else sent you/,
    );
    expect(secretRequestErrorCopy("NOT_FOUND").title).toMatch(/expired/);
  });
});
