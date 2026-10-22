// TEST_OVERVIEW: the deployment's CurveBender is routed to the same upstream, with the same injected credential form, as the user-keyed one, so a session on it reaches the proxy through the gateway's credential chain.
import { describe, expect, it } from "vitest";

import { upstreamWireOf } from "../../modules/model-router/domain/upstream.js";

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
