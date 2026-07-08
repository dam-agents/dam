import { describe, it, expect } from "vitest";
import type { EnvVar } from "api-server-api";
import {
  seedTelemetryIdentity,
  renamedTelemetryIdentity,
} from "../../modules/agents/domain/telemetry-env.js";

const telemetryEnv: EnvVar[] = [
  { name: "CLAUDE_CODE_ENABLE_TELEMETRY", value: "1" },
  { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "https://collector:4318" },
];

describe("seedTelemetryIdentity", () => {
  it("appends the agent name attribute when the template enables telemetry", () => {
    const env = seedTelemetryIdentity(telemetryEnv, "calm-harbor");
    expect(env).toContainEqual({
      name: "OTEL_RESOURCE_ATTRIBUTES",
      value: "platform.agent.name=calm-harbor",
    });
  });

  it("leaves non-telemetry env untouched", () => {
    const env: EnvVar[] = [{ name: "FOO", value: "bar" }];
    expect(seedTelemetryIdentity(env, "calm-harbor")).toBe(env);
  });

  it("merges into an existing OTEL_RESOURCE_ATTRIBUTES, replacing a stale name", () => {
    const env = seedTelemetryIdentity(
      [
        ...telemetryEnv,
        {
          name: "OTEL_RESOURCE_ATTRIBUTES",
          value: "team=blue,platform.agent.name=old",
        },
      ],
      "new-name",
    );
    const attrs = env.find((e) => e.name === "OTEL_RESOURCE_ATTRIBUTES");
    expect(attrs?.value).toBe("team=blue,platform.agent.name=new-name");
    // No duplicate entry appended.
    expect(
      env.filter((e) => e.name === "OTEL_RESOURCE_ATTRIBUTES"),
    ).toHaveLength(1);
  });

  it("percent-encodes names that would break the key=value,: format", () => {
    const env = seedTelemetryIdentity(telemetryEnv, "a,b=c");
    const attrs = env.find((e) => e.name === "OTEL_RESOURCE_ATTRIBUTES");
    expect(attrs?.value).toBe("platform.agent.name=a%2Cb%3Dc");
  });
});

describe("renamedTelemetryIdentity", () => {
  const withAttr: EnvVar[] = [
    ...telemetryEnv,
    {
      name: "OTEL_RESOURCE_ATTRIBUTES",
      value: "platform.agent.name=old-name",
    },
  ];

  it("rewrites the name attribute where it exists", () => {
    const env = renamedTelemetryIdentity(withAttr, "new-name");
    expect(env).not.toBeNull();
    expect(env?.find((e) => e.name === "OTEL_RESOURCE_ATTRIBUTES")?.value).toBe(
      "platform.agent.name=new-name",
    );
  });

  it("returns null when the agent carries no name attribute (never adds one)", () => {
    expect(renamedTelemetryIdentity(telemetryEnv, "any")).toBeNull();
    expect(renamedTelemetryIdentity([], "any")).toBeNull();
  });

  it("returns null when the name is already current (no needless env bump)", () => {
    expect(renamedTelemetryIdentity(withAttr, "old-name")).toBeNull();
  });
});
