// TEST_OVERVIEW: The host side of platform.request. It reads requests only from the preview frame, calls the publishing agent's API through the api-server, and always answers the page, including when the request is bad, the page has too many requests open, or the call throws.

import {
  ARTIFACT_REQUEST_MAX_IN_FLIGHT,
  ARTIFACT_REQUEST_TYPE,
  ARTIFACT_RESPONSE_TYPE,
  type ArtifactCallAgentApiResult,
} from "api-server-api";
import type React from "react";
import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCallAgentApi } from "../../modules/artifacts/api/mutations.js";
import { useArtifactRequest } from "../../modules/artifacts/hooks/use-artifact-request.js";
import { readArtifactRequest } from "../../modules/artifacts/lib/artifact-request.js";

const effects = vi.hoisted(() => new Set<EffectCallback>());

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useEffect: (effect: EffectCallback) => effects.add(effect),
}));
vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useCallAgentApi: vi.fn(),
}));

const getPing = {
  type: ARTIFACT_REQUEST_TYPE,
  id: "1",
  method: "GET",
  path: "/ping",
};

describe("reading artifact requests", () => {
  const pageWindow = {} as MessageEventSource;

  it("accepts only the preview frame and keeps only the request fields", () => {
    const data = { ...getPing, agentId: "other-agent", artifactId: "other" };
    expect(
      readArtifactRequest({ source: pageWindow, data }, pageWindow),
    ).toEqual({
      id: "1",
      request: { method: "GET", path: "/ping" },
    });
    expect(
      readArtifactRequest(
        { source: {} as MessageEventSource, data },
        pageWindow,
      ),
    ).toBeNull();
    expect(readArtifactRequest({ source: pageWindow, data }, null)).toBeNull();
  });

  it.each([
    {},
    { type: "artifact.prompt", prompt: "hi" },
    { ...getPing, id: "" },
    { ...getPing, id: 7 },
  ])("ignores messages that are not requests: %j", (data) => {
    expect(
      readArtifactRequest({ source: pageWindow, data }, pageWindow),
    ).toBeNull();
  });

  it.each([
    { ...getPing, method: "HEAD" },
    { ...getPing, path: "relative" },
    { ...getPing, path: "//other.host/" },
    { ...getPing, method: "POST", body: "x".repeat(1024 * 1024 + 1) },
  ])("marks a request with bad fields as invalid but keeps its id", (data) => {
    expect(
      readArtifactRequest({ source: pageWindow, data }, pageWindow),
    ).toEqual({
      id: "1",
      request: null,
    });
  });
});

describe("answering artifact requests", () => {
  const callAgentApi =
    vi.fn<(input: unknown) => Promise<ArtifactCallAgentApiResult>>();
  const postMessage = vi.fn();
  const frame = {
    current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement,
  };
  const cleanups = new Set<() => void>();

  function mount(artifactId: string | undefined) {
    function Host() {
      useArtifactRequest(frame, artifactId);
      return null;
    }
    renderToStaticMarkup(createElement(Host));
    for (const effect of effects) {
      const cleanup = effect();
      if (cleanup) cleanups.add(cleanup);
    }
  }

  function unmount() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  }

  function send(data: unknown, source: unknown = frame.current.contentWindow) {
    window.dispatchEvent(Object.assign(new Event("message"), { data, source }));
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCallAgentApi).mockReturnValue({
      mutateAsync: callAgentApi,
    } as unknown as ReturnType<typeof useCallAgentApi>);
    callAgentApi.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: "application/json",
      body: '{"pong":1}',
    });
    vi.stubGlobal("window", new EventTarget());
  });

  afterEach(() => {
    unmount();
    effects.clear();
    vi.unstubAllGlobals();
  });

  // TEST_SCENARIO: The page asks for data. The host calls the artifact's agent API with the artifact id it was given, never one from the page, and posts the answer back to the frame.
  it("relays a request for the given artifact and answers the frame", async () => {
    mount("page");
    send({ ...getPing, artifactId: "spoofed" });
    await settle();

    expect(callAgentApi).toHaveBeenCalledExactlyOnceWith({
      artifactId: "page",
      method: "GET",
      path: "/ping",
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: ARTIFACT_RESPONSE_TYPE,
        id: "1",
        ok: true,
        status: 200,
        contentType: "application/json",
        body: '{"pong":1}',
      },
      "*",
    );
  });

  // TEST_SCENARIO: The gate is closed (library view, history version, another agent's chat, flag off). The host does not listen, so no call reaches the server.
  it("does not listen when the bridge is closed", async () => {
    mount(undefined);
    send(getPing);
    await settle();

    expect(callAgentApi).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: Another window posts a request. The host ignores it.
  it("ignores requests from other windows", async () => {
    mount("page");
    send(getPing, {});
    await settle();

    expect(callAgentApi).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The page sends a request with bad fields. The host answers invalid-request without calling the server, so the page's promise does not hang.
  it("answers a bad request without calling the server", async () => {
    mount("page");
    send({ ...getPing, method: "HEAD" });
    await settle();

    expect(callAgentApi).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: ARTIFACT_RESPONSE_TYPE,
        id: "1",
        ok: false,
        reason: "invalid-request",
      },
      "*",
    );
  });

  // TEST_SCENARIO: The page opens one request more than the cap. Only that one is refused, and a new request works again once a slot frees up.
  it("refuses requests over the in-flight cap", async () => {
    const answers: ((result: ArtifactCallAgentApiResult) => void)[] = [];
    callAgentApi.mockImplementation(
      () => new Promise((resolve) => answers.push(resolve)),
    );
    mount("page");
    for (let i = 0; i <= ARTIFACT_REQUEST_MAX_IN_FLIGHT; i++)
      send({ ...getPing, id: `r${i}` });
    await settle();

    expect(callAgentApi).toHaveBeenCalledTimes(ARTIFACT_REQUEST_MAX_IN_FLIGHT);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: ARTIFACT_RESPONSE_TYPE,
        id: `r${ARTIFACT_REQUEST_MAX_IN_FLIGHT}`,
        ok: false,
        reason: "too-many-requests",
      },
      "*",
    );

    answers[0]!({ ok: true, status: 204, contentType: null, body: "" });
    await settle();
    send({ ...getPing, id: "after" });
    await settle();
    expect(callAgentApi).toHaveBeenCalledTimes(
      ARTIFACT_REQUEST_MAX_IN_FLIGHT + 1,
    );
  });

  // TEST_SCENARIO: The call to the api-server throws (for example the network is down). The page gets agent-unreachable.
  it("answers agent-unreachable when the call throws", async () => {
    callAgentApi.mockRejectedValue(new Error("Failed to fetch"));
    mount("page");
    send(getPing);
    await settle();

    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: ARTIFACT_RESPONSE_TYPE,
        id: "1",
        ok: false,
        reason: "agent-unreachable",
      },
      "*",
    );
  });

  // TEST_SCENARIO: The preview closes while a request is open. The late answer is dropped.
  it("drops answers after the frame is gone", async () => {
    let answer: (result: ArtifactCallAgentApiResult) => void = () => {};
    callAgentApi.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    mount("page");
    send(getPing);
    unmount();
    answer({ ok: true, status: 200, contentType: null, body: "late" });
    await settle();

    expect(postMessage).not.toHaveBeenCalled();
  });
});
