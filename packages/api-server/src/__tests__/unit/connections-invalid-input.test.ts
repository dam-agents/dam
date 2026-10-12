import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  createConnectionTemplateRegistry,
  templateToView,
} from "../../modules/connections/domain/connection-template.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: an input the connection builder refuses reaches the user as
 * a 400 that carries the builder's message, not as an internal server error;
 * an env var name the server refuses is also refused by the form's pattern.
 */

configureLogger({ level: "error", write: () => {} });

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

describe("connection create with an invalid input", () => {
  // TEST_SCENARIO: an S3 bucket name with a space and an underscore is refused as BAD_REQUEST with the bucket message.
  it("refuses a bad bucket name as BAD_REQUEST", async () => {
    const svc = createConnectionsService({
      ownerId: "owner",
      templates: createConnectionTemplateRegistry(buildCatalog()),
      repo: unused(),
      secretStore: unused<SecretStore>({
        storeId: "test",
        mintRef: (meta) => ({ storeId: "test", path: meta.purpose, field: "" }),
      }),
      fanOut: unused(),
      oauthFlow: unused(),
      oauthEngine: unused(),
      githubAppEngine: unused(),
      s3CredentialProbe: unused(),
      providerBalance: unused(),
      providerKeyProbe: unused(),
      oauthCallbackUrl: "https://example.com/callback",
      brandName: "Test",
      connectionLock: (_key, fn) => fn(),
      isOwnedAgent: async () => true,
      resolveKbShare: unused(),
    });
    const err = await svc
      .createFromTemplate({
        templateId: "s3-compatible",
        name: "bucket",
        authKind: "sigv4",
        endpoint: "https://s3.example.com",
        bucket: "Bad_Bucket Name",
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err).toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/is not a bucket name/),
    });
  });
});

describe("env var name input", () => {
  // TEST_SCENARIO: the custom header template's env var name input carries a pattern that refuses what the create schema refuses.
  it.each(["custom-header", "custom-client-credentials"])(
    "%s refuses 1BAD-VAR in the form",
    (id) => {
      const template =
        createConnectionTemplateRegistry(buildCatalog()).get(id)!;
      const input = templateToView(
        template,
        "https://example.com/cb",
      ).inputs.find((i) => i.name === "envName");
      const pattern = new RegExp(input!.pattern!);
      expect(pattern.test("1BAD-VAR")).toBe(false);
      expect(pattern.test("MY_API_KEY")).toBe(true);
    },
  );
});
