import { describe, it, expect } from "vitest";
import {
  buildSshEnvironmentFile,
  SSHD_MAX_ENV_ENTRIES,
} from "../../modules/ssh.js";

// TEST_OVERVIEW: `~/.ssh/environment` is what gives an SSH session the agent pod's
// environment. sshd reads it into the login shell and dies with
// "child_set_env: too many env vars" past 1000 entries, so the file must stay under
// that limit and keep the entries that matter (credentials, proxy, PATH) when it has
// to drop some.

const keys = (body: string) =>
  body
    .trim()
    .split("\n")
    .map((l) => l.split("=")[0]);

describe("buildSshEnvironmentFile", () => {
  // TEST_SCENARIO: A pod that inherits hundreds of Kubernetes service-link vars on top
  // of its own environment. The file must stay within the sshd limit, and the service
  // links — useless in a shell — are the ones that go, not the credentials.
  it("caps the file and drops service links first", () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_AUTH_TOKEN: "t",
      HTTPS_PROXY: "p",
    };
    for (let i = 0; i < 1500; i++)
      env[`SVC_${i}_PORT_443_TCP_ADDR`] = "10.0.0.1";

    const warnings: string[] = [];
    const body = buildSshEnvironmentFile(env, (m) => warnings.push(m));
    const names = keys(body);

    expect(names).toHaveLength(SSHD_MAX_ENV_ENTRIES);
    expect(names).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(names).toContain("HTTPS_PROXY");
    expect(warnings.join()).toContain("dropped 552 env vars");
  });

  // TEST_SCENARIO: The ordinary case — a small environment passes through untouched.
  it("keeps every var when the environment fits", () => {
    const body = buildSshEnvironmentFile({
      PATH: "/bin",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
    });
    expect(keys(body)).toEqual(["PATH", "KUBERNETES_SERVICE_HOST"]);
  });
});
