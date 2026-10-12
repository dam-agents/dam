import { describe, expect, it } from "vitest";
import { createBuiltinContributions } from "../../modules/runtime-delivery/services/builtin-contributions.js";

const RAILS: Record<string, { name: string; value: string }[]> = {
  "claude-code": [
    { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
  ],
  bob: [{ name: "BOB_TELEMETRY_URL", value: "https://collector:4318" }],
};

const builtin = createBuiltinContributions({
  harnessServerUrl: "http://harness:4001",
  telemetryEnv: (harness) => RAILS[harness] ?? [],
});

const envOf = (harnesses: string[]) =>
  builtin
    .for("a1", { sharedKnowledgeBases: false, harnesses })
    .filter((c) => c.kind === "env");

describe("builtin telemetry rails", () => {
  /** TEST_SCENARIO: A runtime that keeps each harness's env apart gets every
   * harness's export rail, each tagged with its harness, so a Bob lease never
   * sees the OTLP settings that would send its export to the vendor. */
  it("tags each rail with the harness that reads it", () => {
    expect(envOf(["claude-code", "bob"])).toEqual([
      {
        kind: "env",
        name: "OTEL_EXPORTER_OTLP_PROTOCOL",
        placeholder: "http/protobuf",
        harness: "claude-code",
      },
      {
        kind: "env",
        name: "BOB_TELEMETRY_URL",
        placeholder: "https://collector:4318",
        harness: "bob",
      },
    ]);
  });

  /** TEST_SCENARIO: A runtime too old to keep harnesses apart would merge
   * every rail into one env, so it gets none; its agent keeps the rail it
   * was created with. */
  it("sends no rail to a runtime that advertises no harnesses", () => {
    expect(envOf([])).toEqual([]);
  });
});
