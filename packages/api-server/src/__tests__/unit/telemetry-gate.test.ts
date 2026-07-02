import { describe, expect, it } from "vitest";
import { isOtelEnabled } from "../../telemetry-gate.js";

describe("isOtelEnabled", () => {
  it.each([
    ["no env at all", {}, false],
    [
      "endpoint set",
      { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" },
      true,
    ],
    ["blank endpoint", { OTEL_EXPORTER_OTLP_ENDPOINT: "   " }, false],
    [
      "per-signal endpoint only",
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector:4318/v1/traces" },
      true,
    ],
    [
      "disabled wins over endpoint",
      {
        OTEL_SDK_DISABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      },
      false,
    ],
    [
      "disabled is case-insensitive",
      {
        OTEL_SDK_DISABLED: "TRUE",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      },
      false,
    ],
    [
      "disabled=false does not disable",
      {
        OTEL_SDK_DISABLED: "false",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      },
      true,
    ],
    [
      "disabled without endpoint stays off",
      { OTEL_SDK_DISABLED: "false" },
      false,
    ],
  ])("%s -> %s", (_name, env, expected) => {
    expect(isOtelEnabled(env)).toBe(expected);
  });
});
