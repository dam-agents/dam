import { describe, expect, it } from "vitest";
import {
  LABEL_INSTANCE_REF,
  LABEL_ROLE,
  ROLE_AGENT,
  ROLE_GATEWAY,
} from "../../modules/agents/infrastructure/labels.js";

// Pins the on-the-wire label keys and values the controller's NetworkPolicy
// selectors and the api-server's pod-IP resolver both depend on. The Go
// side has a mirror test in
// `packages/controller/pkg/reconciler/gateway_test.go (TestLabelContract)`.
// Drift between the two would silently break the credential boundary
// (ADR-038 §Threat Model).
describe("paired-pod label contract (ADR-038)", () => {
  it("pins keys/values the controller's Go constants must equal", () => {
    expect(LABEL_INSTANCE_REF).toBe("agent-platform.ai/instance");
    expect(LABEL_ROLE).toBe("agent-platform.ai/role");
    expect(ROLE_AGENT).toBe("agent");
    expect(ROLE_GATEWAY).toBe("gateway");
  });
});
