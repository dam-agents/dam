// TEST_OVERVIEW: the deployment's CurveBender is routed to the same upstream, with the same injected credential form, as the user-keyed one, so a session on it reaches the proxy through the gateway's credential chain. CurveBender through the IBM Cloud Gateway is routed under the project endpoint, whose path already carries the API version, with the Connection's placeholder as a bearer token.
import { describe, expect, it } from "vitest";

import {
  upstreamUrl,
  upstreamWireOf,
} from "../../modules/model-router/domain/upstream.js";

describe("deployment CurveBender upstream", () => {
  // TEST_SCENARIO: both CurveBender templates resolve to the proxy's root and send the Connection's placeholder as a bearer token, so the gateway names the Connection and injects the deployment's key.
  it("routes like the user-keyed CurveBender", () => {
    const env = {
      OPENAI_BASE_URL: "https://litellm.cb.example/v1",
      OPENAI_API_KEY: "platform:conn:conn-cbd",
    };
    const wire = {
      root: "https://litellm.cb.example",
      credential: {
        header: "authorization",
        value: "Bearer platform:conn:conn-cbd",
      },
    };
    expect(upstreamWireOf("curve-bender-deployment", env)).toEqual(wire);
    expect(upstreamWireOf("curve-bender", env)).toEqual(wire);
  });
});

describe("IBM Cloud Gateway upstream", () => {
  const endpoint = "https://us-east.rhai.ibm.com/v1/projects/p-1/inference";
  const env = {
    OPENAI_BASE_URL: `${endpoint}/`,
    OPENAI_API_KEY: "platform:conn:conn-gw",
  };

  // TEST_SCENARIO: a chat call goes to the project endpoint's own chat route, not under a second `/v1`, carrying the placeholder the credential gateway swaps for the gateway key.
  it("sends a chat call under the project endpoint", () => {
    const wire = upstreamWireOf("curve-bender-cloud-gateway", env);
    expect(wire).toEqual({
      root: endpoint,
      credential: {
        header: "authorization",
        value: "Bearer platform:conn:conn-gw",
      },
      versionedRoot: true,
    });
    expect(
      upstreamUrl(wire!, "openai-chat", "/v1/chat/completions", "?stream=1"),
    ).toBe(`${endpoint}/chat/completions?stream=1`);
  });

  // TEST_SCENARIO: a layer with no endpoint has no upstream, so the router refuses the call instead of sending it anywhere.
  it("has no upstream without an endpoint", () => {
    expect(
      upstreamWireOf("curve-bender-cloud-gateway", {
        OPENAI_API_KEY: "platform:conn:conn-gw",
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: a provider with an unversioned root keeps the dialect's full path.
  it("keeps the full dialect path for an unversioned root", () => {
    const wire = upstreamWireOf("curve-bender", {
      OPENAI_BASE_URL: "https://litellm.cb.example/v1",
      OPENAI_API_KEY: "platform:conn:conn-cb",
    });
    expect(upstreamUrl(wire!, "openai-chat", "/v1/chat/completions", "")).toBe(
      "https://litellm.cb.example/v1/chat/completions",
    );
  });
});
