import { describe, expect, it } from "vitest";

import {
  ARTIFACT_REQUEST_SOURCE_MAX_BYTES,
  buildArtifactRequestPrompt,
} from "../../modules/artifact-library/domain/artifact-request-prompt.js";

// TEST_OVERVIEW: The prompt is the whole brief the agent gets for one Artifact Request. It has to say which page asked, what it asked for with its arguments, whether a person is waiting, and that the answer only counts when `answer_artifact_request` is called with that request id — finishing the turn answers nothing. The page's source rides along on the first request of a session, because later requests land in the same session, which already holds it. A page too big to inline is named as a tool call instead of being cut in half.

const base = {
  requestId: "req-1",
  artifactId: "art-1",
  title: "Weather board",
  seq: 1,
  action: "refresh",
  payload: { city: "Prague" },
  trigger: "user" as const,
  source: null,
};

describe("the prompt for one request", () => {
  // TEST_SCENARIO: Everything the agent needs to act: which page, what was asked, and the arguments the page sent.
  it("states the page, the action and the payload", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).toContain("Weather board");
    expect(prompt).toContain("art-1");
    expect(prompt).toContain("Request #1");
    expect(prompt).toContain("action: refresh");
    expect(prompt).toContain('"city":"Prague"');
  });

  // TEST_SCENARIO: An agent that just finishes its turn leaves the page waiting until the request expires, so the prompt has to name the tool, the request id, and that the turn is not the answer.
  it("names the answer tool and the request id", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).toContain("answer_artifact_request");
    expect(prompt).toContain('request_id "req-1"');
    expect(prompt).toMatch(/Finishing your turn is not an answer/);
  });

  // TEST_SCENARIO: A page refreshing itself has nobody watching. The agent should know that before it decides how much work to do.
  it("says whether a person is waiting", () => {
    expect(buildArtifactRequestPrompt(base)).toMatch(/A person is looking/);
    expect(buildArtifactRequestPrompt({ ...base, trigger: "auto" })).toMatch(
      /nobody clicking/,
    );
  });

  // TEST_SCENARIO: The first request opens the session, so it carries the source. Later requests resume that session and must not repeat it.
  it("inlines the source only when it is given", () => {
    const withSource = buildArtifactRequestPrompt({
      ...base,
      source: "<h1>board</h1>",
    });
    expect(withSource).toContain("<h1>board</h1>");
    expect(withSource).toContain("first request in this session");
    expect(buildArtifactRequestPrompt(base)).not.toContain("```html");
  });

  // TEST_SCENARIO: A page can be megabytes. Half a page would mislead the agent, so an oversized page is not inlined at all and the agent is told to read it with a tool.
  it("points at get_artifact instead of inlining an oversized page", () => {
    const prompt = buildArtifactRequestPrompt({
      ...base,
      source: "x".repeat(ARTIFACT_REQUEST_SOURCE_MAX_BYTES + 1),
    });
    expect(prompt).not.toContain("```html");
    expect(prompt).toContain("get_artifact");
  });
});
