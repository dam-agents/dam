import { describe, it, expect } from "vitest";
import {
  buildExtAuthzSynthFrame,
  syntheticSessionId,
} from "../../modules/approvals/infrastructure/acp-frames.js";

describe("buildExtAuthzSynthFrame", () => {
  // Regression guard: a missing JSON-RPC `id` flips the frame to a notification
  // and the ACP SDK routes it through `extNotification` instead of the request
  // handler, so the live-UI inbox prompt never fires (ADR-035 §"Inbox").
  it("emits a JSON-RPC request (with `id`), not a notification", () => {
    const frame = JSON.parse(
      buildExtAuthzSynthFrame({
        approvalId: "abc-123",
        host: "example.com",
        method: "GET",
        path: "/v1/foo",
      }),
    );
    expect(frame.jsonrpc).toBe("2.0");
    expect(frame.id).toBe("abc-123");
    expect(frame.method).toBe("session/request_permission");
  });

  it("uses the synth session id so the UI diverts to the inbox", () => {
    const frame = JSON.parse(
      buildExtAuthzSynthFrame({
        approvalId: "abc-123",
        host: "example.com",
        method: "POST",
        path: "/x",
      }),
    );
    expect(frame.params.sessionId).toBe(syntheticSessionId("abc-123"));
  });
});
