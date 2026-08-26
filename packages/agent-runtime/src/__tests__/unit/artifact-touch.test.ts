import { describe, expect, it } from "vitest";
import { artifactTouchIn } from "../../modules/acp/domain/artifact-touch.js";

const SESSION = "abe53601-a7a2-4d17-9726-d93af979937a";
const ARTIFACT = "38172c69-e53f-45fd-9b2e-5e7bc018fdd7";

// TEST_OVERVIEW: The result payload below was captured from a live run against
// TEST_OVERVIEW: claude-agent-acp 0.66.0, the version pinned in
// TEST_OVERVIEW: packages/agents/claude-code/harness-tools.toml. The frame around it
// TEST_OVERVIEW: carries the fields that adapter's emitter sets on a finished tool
// TEST_OVERVIEW: call. Re-capture both when that pin moves: a stale fixture keeps
// TEST_OVERVIEW: passing while the wire changes underneath it.
const CAPTURED_RESULT = `{
  "id": "${ARTIFACT}",
  "title": "Touch Test",
  "slug": "VyzZgo8YejFVMA",
  "kind": "markdown",
  "contentType": "text/markdown; charset=utf-8",
  "fileName": "touch-test.md",
  "sizeBytes": 66,
  "version": 1,
  "folderId": null,
  "agentId": "agent-72e1602666db05d0",
  "visibility": "private",
  "expiresAt": null,
  "viewCount": 0,
  "shareUrl": null,
  "createdAt": "2026-08-26T11:43:50.706Z",
  "updatedAt": "2026-08-26T11:43:50.706Z",
  "internal_link": "platform://artifacts/${ARTIFACT}",
  "platform_artifact_touch": {
    "v": 1,
    "artifactId": "${ARTIFACT}",
    "version": 1
  }
}`;

function frame(update: unknown, sessionId: string = SESSION): unknown {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  };
}

function completed(rawOutput: unknown): unknown {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_01BNxqTukGY6jGr8Po93Q7Cm",
    status: "completed",
    rawOutput,
  };
}

describe("artifactTouchIn", () => {
  it("reads the session and artifact out of a captured tool result", () => {
    const touch = artifactTouchIn(
      frame(completed([{ type: "text", text: CAPTURED_RESULT }])),
    );

    expect(touch).toEqual({
      sessionId: SESSION,
      artifactId: ARTIFACT,
      version: 1,
    });
  });

  // TEST_SCENARIO: the adapter passes the tool's result through, so the shape it
  // TEST_SCENARIO: arrives in is the tool's, not ours.
  it("accepts a result that arrives as bare text", () => {
    expect(artifactTouchIn(frame(completed(CAPTURED_RESULT)))).toEqual({
      sessionId: SESSION,
      artifactId: ARTIFACT,
      version: 1,
    });
  });

  it("ignores a tool result with no marker", () => {
    const other = JSON.stringify({ id: ARTIFACT, title: "Touch Test" });
    expect(
      artifactTouchIn(frame(completed([{ type: "text", text: other }]))),
    ).toBeNull();
  });

  // TEST_SCENARIO: a marker version we do not know means the payload changed, and
  // TEST_SCENARIO: guessing at it would attribute an artifact to the wrong session.
  it("ignores a marker from a version it does not know", () => {
    const future = JSON.stringify({
      platform_artifact_touch: { v: 99, artifactId: ARTIFACT, version: 1 },
    });
    expect(
      artifactTouchIn(frame(completed([{ type: "text", text: future }]))),
    ).toBeNull();
  });

  it("ignores text that is not JSON", () => {
    expect(
      artifactTouchIn(frame(completed([{ type: "text", text: "{ oops" }]))),
    ).toBeNull();
    expect(
      artifactTouchIn(
        frame(completed([{ type: "text", text: "Saved the artifact." }])),
      ),
    ).toBeNull();
  });

  // TEST_SCENARIO: a call that failed produced no version, so there is nothing to
  // TEST_SCENARIO: attribute even though the payload still names an artifact.
  it("ignores a failed tool call", () => {
    const update = {
      ...(completed([{ type: "text", text: CAPTURED_RESULT }]) as object),
      status: "failed",
    };
    expect(artifactTouchIn(frame(update))).toBeNull();
  });

  it("ignores an update that is not a finished tool call", () => {
    expect(
      artifactTouchIn(
        frame({ sessionUpdate: "agent_message_chunk", text: "working" }),
      ),
    ).toBeNull();
  });

  it("ignores a frame with no session", () => {
    expect(
      artifactTouchIn(
        frame(completed([{ type: "text", text: CAPTURED_RESULT }]), ""),
      ),
    ).toBeNull();
  });
});
