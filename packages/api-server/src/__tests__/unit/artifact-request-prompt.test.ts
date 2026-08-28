import { describe, expect, it } from "vitest";

import {
  ARTIFACT_REQUEST_SOURCE_MAX_BYTES,
  buildArtifactRequestPrompt,
} from "../../modules/artifact-library/domain/artifact-request-prompt.js";

// TEST_OVERVIEW: The prompt is everything the agent gets for one Artifact Request, and it is kept short on purpose: the rules for answering are written on the `answer_artifact_request` tool, so repeating them in every prompt would pay for the same words on every turn the page causes. What the prompt must carry is what the tool cannot know — which page asked, what it asked for with its arguments, and the request id, plus one line that the answer is the tool call and not a reply. A prompt for a page bound to a conversation is shorter again: it lands in a chat a person reads, so it carries no source (that conversation wrote the page), no line about who is waiting (a bound page cannot self-refresh, so a person always is), and the brief only on the ask that bound it, since the conversation keeps its own history. A page's own Artifact Session keeps both: the source on its first request, and the brief on every one, because that session starts cold and can see nothing else.

const base = {
  requestId: "req-1",
  artifactId: "art-1",
  title: "Weather board",
  seq: 1,
  action: "refresh",
  payload: { city: "Prague" },
  trigger: "user" as const,
  bound: false,
  brief: null,
  source: null,
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

  // TEST_SCENARIO: An agent that just finishes its turn leaves the page waiting until the request expires, so the prompt has to name the tool, the request id, and that the turn is not the answer.
  it("names the answer tool and the request id", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).toContain("answer_artifact_request");
    expect(prompt).toContain('request_id "req-1"');
    expect(prompt).toMatch(/not the answer/);
  });

  // TEST_SCENARIO: The rules for answering are written on the tool, so the prompt must not restate them. Every sentence it repeats is charged to every turn the page ever causes.
  it("leaves the tool's own rules to the tool", () => {
    const prompt = buildArtifactRequestPrompt(base);
    expect(prompt).not.toContain("shape it for the page");
    expect(prompt).not.toContain("exactly one answer");
    expect(prompt).not.toContain("small steps");
    expect(prompt.length).toBeLessThan(500);
  });

  // TEST_SCENARIO: A bound page's ask lands in a conversation somebody is reading, so the answer line has to say that replying there is not the answer — in its own session there is nobody to reply to, and the same mistake is just a finished turn.
  it("says what does not count as an answer, in the terms of where it lands", () => {
    expect(buildArtifactRequestPrompt({ ...base, bound: true })).toContain(
      "reply in this conversation is not the answer",
    );
    expect(buildArtifactRequestPrompt(base)).toContain(
      "Finishing your turn is not the answer",
    );
  });

  // TEST_SCENARIO: The brief is what the agent left for a session that cannot see the conversation the page was written in. It has to arrive before the request, so the agent reads its own instructions before it reads what was asked.
  it("puts the brief ahead of the request", () => {
    const prompt = buildArtifactRequestPrompt({
      ...base,
      brief: "Ask one interview question at a time. Never repeat one.",
    });
    expect(prompt).toContain("Ask one interview question at a time");
    expect(prompt.indexOf("one interview question")).toBeLessThan(
      prompt.indexOf("Request #1"),
    );
  });

  // TEST_SCENARIO: Most pages have no brief. Their prompt must not mention one, or the agent looks for instructions that were never written.
  it("says nothing about a brief when there is none", () => {
    expect(buildArtifactRequestPrompt(base)).not.toContain("brief");
  });

  // TEST_SCENARIO: A page refreshing itself has nobody watching. The agent should know that before it decides how much work to do.
  it("says whether a person is waiting", () => {
    expect(buildArtifactRequestPrompt(base)).toMatch(/A person is looking/);
    expect(buildArtifactRequestPrompt({ ...base, trigger: "auto" })).toMatch(
      /nobody clicking/,
    );
  });

  // TEST_SCENARIO: A bound page is refused automatic asks, so a person is always waiting. Saying so on every ask is a constant, and a constant carries nothing.
  it("says nothing about who is waiting on a bound page", () => {
    const prompt = buildArtifactRequestPrompt({ ...base, bound: true });
    expect(prompt).not.toMatch(/A person is looking/);
    expect(prompt).not.toMatch(/nobody clicking/);
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

  // TEST_SCENARIO: A bound page asks in the conversation that wrote it, and a person reads that conversation. Dumping 128 KB of HTML into it is noise the agent already has, and the artifact id on the first line is all it needs to read the page back.
  it("carries no source and no source pointer for a bound page", () => {
    const prompt = buildArtifactRequestPrompt({ ...base, bound: true });
    expect(prompt).not.toContain("```html");
    expect(prompt).not.toContain("get_artifact");
    expect(prompt).toContain("art-1");
  });

  // TEST_SCENARIO: The brief's own wording is a claim about where the request lands. Telling a bound session it cannot see this conversation would be a lie, so the reason for reading the brief changes with the binding.
  it("explains the brief differently for a bound page", () => {
    const brief = "Ask one interview question at a time.";
    expect(buildArtifactRequestPrompt({ ...base, brief })).toContain(
      "cannot see the conversation the page was written in",
    );
    const inChat = buildArtifactRequestPrompt({ ...base, brief, bound: true });
    expect(inChat).toContain(brief);
    expect(inChat).not.toContain("cannot see the conversation");
    expect(inChat).toContain("Later asks do not repeat them");
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
