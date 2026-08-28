import { ARTIFACT_REQUEST_ACTION_MAX_LENGTH } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  deriveRequestProgress,
  describeFailure,
  failureFromError,
  failureReasonOf,
  progressLabel,
} from "../../modules/artifacts/lib/artifact-request-status.js";
import { readPageRequest } from "../../modules/artifacts/lib/page-request.js";

const pageWindow = { name: "the artifact's iframe" } as unknown as Window;
const otherWindow = { name: "some other frame" } as unknown as Window;

function fromPage(data: unknown) {
  return readPageRequest({ source: pageWindow, data }, pageWindow);
}

// TEST_OVERVIEW: The browser bridge is the half of an Artifact Request a person watches. The page hands the app one message shape and nothing else counts, so anything that is not a well-formed `artifact.request` is dropped rather than turned into a call. While the request is out, the app names what is really happening — it sent it, the agent is coming up, the agent has it — from the request row and the agent's own run state, never from a timer in the browser. When it ends badly, each named reason gets its own wording and, where there is one, its next step; a refusal the server typed rides back on the error, and anything else is reported as the request never reaching the agent.

describe("reading what the page sent", () => {
  const wellFormed = {
    type: "artifact.request",
    ref: "r-1",
    action: "refresh",
    payload: { since: "yesterday" },
  };

  test("takes a well-formed request", () => {
    expect(fromPage(wellFormed)).toEqual(wellFormed);
  });

  test("takes a request with no payload", () => {
    const noPayload = {
      type: "artifact.request",
      ref: "r-1",
      action: "refresh",
    };
    expect(fromPage(noPayload)).toEqual(noPayload);
  });

  // TEST_SCENARIO: The app listens on its own window, which any frame on the page can post to. Only the artifact's own iframe may drive its agent.
  test("drops the same request sent by any other window", () => {
    expect(
      readPageRequest({ source: otherWindow, data: wellFormed }, pageWindow),
    ).toBeNull();
    expect(
      readPageRequest({ source: null, data: wellFormed }, pageWindow),
    ).toBeNull();
  });

  test("drops everything while the frame has no window yet", () => {
    expect(
      readPageRequest({ source: pageWindow, data: wellFormed }, null),
    ).toBeNull();
  });

  // TEST_SCENARIO: The same window carries the experiment dashboard feed and whatever else a page decides to post. Only the pinned shape may become a call to the agent.
  test.each([
    ["another message type", { type: "experiment-feed", feed: [] }],
    ["no type at all", { ref: "r-1", action: "refresh" }],
    ["no ref", { type: "artifact.request", action: "refresh" }],
    ["an empty ref", { type: "artifact.request", ref: "", action: "go" }],
    ["an empty action", { type: "artifact.request", ref: "r-1", action: " " }],
    ["a payload that is not an object", { ...wellFormed, payload: "nope" }],
    ["a string", "artifact.request"],
    ["nothing", undefined],
  ])("drops %s", (_case, data) => {
    expect(fromPage(data)).toBeNull();
  });

  test("drops an action longer than the server accepts", () => {
    expect(
      fromPage({
        ...wellFormed,
        action: "a".repeat(ARTIFACT_REQUEST_ACTION_MAX_LENGTH + 1),
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: The page can put anything on the message. Only the pinned fields may travel on to the server.
  test("keeps only the pinned fields", () => {
    expect(
      fromPage({ ...wellFormed, trigger: "auto", agentId: "a-1" }),
    ).toEqual(wellFormed);
  });
});

describe("naming what is happening", () => {
  // TEST_SCENARIO: The row is committed but delivery has not started, so all the app can honestly say is that it sent the request.
  test("a request with no row yet is sent", () => {
    expect(deriveRequestProgress(undefined, "running")).toBe("sent");
  });

  test("a pending request on a sleeping agent is waking", () => {
    expect(deriveRequestProgress("pending", "hibernated")).toBe("waking");
    expect(deriveRequestProgress("pending", "starting")).toBe("waking");
    expect(deriveRequestProgress("pending", "preparing_workspace")).toBe(
      "waking",
    );
  });

  // TEST_SCENARIO: The agent is up but has not taken the event out of its outbox yet. That is a queue, not a cold start, and saying "waking" here would be a lie the person can see through.
  test("a pending request on a running agent is queued", () => {
    expect(deriveRequestProgress("pending", "running")).toBe("queued");
  });

  test("a delivered request is running whatever the agent looks like", () => {
    expect(deriveRequestProgress("delivered", "hibernated")).toBe("running");
    expect(deriveRequestProgress("delivered", "running")).toBe("running");
  });

  test("every progress has its own wording", () => {
    const labels = (["sent", "waking", "queued", "running"] as const).map(
      progressLabel,
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("saying what went wrong", () => {
  const reasons = [
    "agent_deleted",
    "session_deleted",
    "wake_failed",
    "over_budget",
    "rate_limited",
    "busy",
    "cancelled",
    "expired",
  ] as const;

  test("every named reason has its own message", () => {
    const messages = reasons.map((reason) => describeFailure(reason).message);
    expect(new Set(messages).size).toBe(reasons.length);
  });

  // TEST_SCENARIO: A reason a person can act on has to say what to do. Being cancelled is the one thing with nothing left to do.
  test("a reason with a way forward carries its next step", () => {
    expect(describeFailure("over_budget").nextStep).toBeTruthy();
    expect(describeFailure("rate_limited").nextStep).toBeTruthy();
    expect(describeFailure("busy").nextStep).toBeTruthy();
    expect(describeFailure("cancelled").nextStep).toBeNull();
  });

  test("agent_deleted says the page still works", () => {
    expect(describeFailure("agent_deleted").nextStep).toContain(
      "page still works",
    );
  });

  // TEST_SCENARIO: Deleting a conversation kills a bound page's interactivity and nothing else, the same degradation as a deleted agent. The person has to read that the document survives.
  test("session_deleted says the page still works", () => {
    expect(describeFailure("session_deleted").message).toContain(
      "conversation this page asks in",
    );
    expect(describeFailure("session_deleted").nextStep).toContain(
      "page still works",
    );
  });

  test("lifts the reason the server typed onto the error", () => {
    const refused = {
      data: { artifactRequestRefusal: { reason: "rate_limited" } },
    };
    expect(failureReasonOf(refused)).toBe("rate_limited");
    expect(failureFromError(refused)).toEqual(describeFailure("rate_limited"));
  });

  test.each([
    ["a plain error", new Error("boom")],
    ["an error with no data", { message: "boom" }],
    ["an unknown refusal reason", { data: { artifactRequestRefusal: {} } }],
    [
      "a reason outside the set",
      { data: { artifactRequestRefusal: { reason: "nope" } } },
    ],
  ])("reads no named reason from %s", (_case, error) => {
    expect(failureReasonOf(error)).toBeNull();
  });

  // TEST_SCENARIO: A dropped connection or a page deleted between render and click has no named reason, but the page is still waiting and has to be told the ask is over.
  test("an untyped failure keeps the server's own words", () => {
    const failure = failureFromError({ message: "artifact not found" });
    expect(failure.reason).toBe("wake_failed");
    expect(failure.message).toBe("artifact not found");
  });

  test("an untyped failure with nothing to say still says something", () => {
    expect(failureFromError(undefined).message).toBe(
      "The request never reached the agent.",
    );
  });
});
