import type * as k8s from "@kubernetes/client-node";
import { describe, it, expect } from "vitest";

import { stripStaleModelPins } from "../../modules/secrets/infrastructure/strip-stale-model-pins.js";

const ANN = "agent-platform.ai/env-mappings";

function secret(name: string, mappings: unknown): k8s.V1Secret {
  return {
    metadata: {
      name,
      annotations: {
        "agent-platform.ai/host-pattern": "example.com",
        ...(mappings === undefined ? {} : { [ANN]: JSON.stringify(mappings) }),
      },
    },
  };
}

function makeClient(secrets: k8s.V1Secret[]) {
  const replaced: { name: string; body: k8s.V1Secret }[] = [];
  let selector = "";
  return {
    replaced,
    selector: () => selector,
    client: {
      listSecrets: (labelSelector: string) => {
        selector = labelSelector;
        return Promise.resolve(secrets);
      },
      replaceSecret: (name: string, body: k8s.V1Secret) => {
        replaced.push({ name, body });
        return Promise.resolve(body);
      },
    },
  };
}

describe("stripStaleModelPins", () => {
  it("targets only api-server-managed ibm-litellm secrets", async () => {
    const { client, selector } = makeClient([]);
    await stripStaleModelPins(client);
    expect(selector()).toBe(
      "agent-platform.ai/secret-type=ibm-litellm,agent-platform.ai/managed-by=api-server",
    );
  });

  it("removes pin vars and keeps the rest of the mappings", async () => {
    const { client, replaced } = makeClient([
      secret("platform-cred-a", [
        { envName: "ANTHROPIC_AUTH_TOKEN", placeholder: "sk-dummy" },
        {
          envName: "ANTHROPIC_MODEL",
          placeholder: "claude/aws/claude-opus-4-1",
        },
        { envName: "ANTHROPIC_DEFAULT_SONNET_MODEL", placeholder: "x" },
        { envName: "CLAUDE_CODE_SUBAGENT_MODEL", placeholder: "x" },
        { envName: "OPENAI_MODEL", placeholder: "gpt-5.5" },
      ]),
    ]);
    const patched = await stripStaleModelPins(client);
    expect(patched).toBe(1);
    const ann = replaced[0]!.body.metadata!.annotations![ANN]!;
    expect(JSON.parse(ann).map((m: { envName: string }) => m.envName)).toEqual([
      "ANTHROPIC_AUTH_TOKEN",
      "OPENAI_MODEL",
    ]);
    // The unrelated annotation survives the patch.
    expect(
      replaced[0]!.body.metadata!.annotations![
        "agent-platform.ai/host-pattern"
      ],
    ).toBe("example.com");
  });

  it("drops the annotation entirely when only pins were stored", async () => {
    const { client, replaced } = makeClient([
      secret("platform-cred-b", [
        { envName: "ANTHROPIC_MODEL", placeholder: "x" },
      ]),
    ]);
    await stripStaleModelPins(client);
    expect(replaced[0]!.body.metadata!.annotations![ANN]).toBeUndefined();
  });

  it("no-ops on secrets without pins — idempotent across boots", async () => {
    const { client, replaced } = makeClient([
      secret("platform-cred-c", [
        { envName: "ANTHROPIC_AUTH_TOKEN", placeholder: "sk-dummy" },
      ]),
      secret("platform-cred-d", undefined),
    ]);
    const patched = await stripStaleModelPins(client);
    expect(patched).toBe(0);
    expect(replaced).toHaveLength(0);
  });

  it("skips malformed annotations instead of throwing", async () => {
    const broken: k8s.V1Secret = {
      metadata: {
        name: "platform-cred-e",
        annotations: { [ANN]: "{not json" },
      },
    };
    const { client, replaced } = makeClient([broken]);
    await expect(stripStaleModelPins(client)).resolves.toBe(0);
    expect(replaced).toHaveLength(0);
  });
});
