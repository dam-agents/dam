import { describe, expect, it } from "vitest";

import { buildArtifactRequestPrompt } from "../../modules/artifact-library/domain/artifact-request-prompt.js";

// TEST_OVERVIEW: The prompt is everything the agent gets for one Artifact Request, and it is kept short on purpose: the rules for answering are written on the `answer_artifact_request` tool, so repeating them in every prompt would pay for the same words on every turn the page causes. What the prompt must carry is what the tool cannot know — which page asked, what it asked for with its arguments, and the request id, plus one line that a reply in the conversation is not the answer. One shape serves every ask: the request lands in the conversation the page belongs to, which usually wrote the page, and when it did not, the artifact id is enough for the agent to read the page back with `get_artifact`.

const base = {
  requestId: "req-1",
  artifactId: "art-1",
  title: "Weather board",
  seq: 1,
  action: "refresh",
  payload: { city: "Prague" },
};

describe("the prompt for one request", () => {
  // TEST_SCENARIO: Everything the agent needs to act: which page, what was asked, and the arguments the page sent.
  it("states the page, the action and the payload", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).toContain("Weather board");
    expect(prompt).toContain("art-1");
    expect(prompt).toContain("Request #1: refresh");
    expect(prompt).toContain('"city":"Prague"');
  });

  // TEST_SCENARIO: An agent that just finishes its turn leaves the page waiting until the request expires, so the prompt has to name the tool, the request id, and that a reply in the chat is not the answer.
  it("names the answer tool and the request id", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).toContain("answer_artifact_request");
    expect(prompt).toContain('request_id "req-1"');
    expect(prompt).toContain("reply in this conversation is not the answer");
  });

  // TEST_SCENARIO: The rules for answering are written on the tool, so the prompt must not restate them. Every sentence it repeats is charged to every turn the page ever causes.
  it("leaves the tool's own rules to the tool", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).not.toContain("shape it for the page");
    expect(prompt).not.toContain("exactly one answer");
    expect(prompt).not.toContain("small steps");
    expect(prompt.length).toBeLessThan(500);
  });

  // TEST_SCENARIO: The ask lands in a conversation that usually wrote the page, and a person reads it. Dumping the page's HTML into it is noise the agent already has, and the artifact id on the first line is all it needs to read the page back.
  it("carries no source and no source pointer", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).not.toContain("```html");
    expect(prompt).not.toContain("get_artifact");
    expect(prompt).toContain("art-1");
  });
});
