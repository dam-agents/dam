// TEST_OVERVIEW: Only Codex's recognized native ChatGPT status means signed in. Errors, API keys, and timeouts never produce a ready badge or leak CLI output.
import { err, ok } from "agent-runtime-api";
import { describe, expect, it, vi } from "vitest";
import { createNativeLoginService } from "../../modules/native-login/compose.js";

describe("native ChatGPT login status", () => {
  it.each([
    [ok({ stdout: "", stderr: "Logged in using ChatGPT\n" }), "signed-in"],
    [
      err({ kind: "exited", code: 1, stdout: "", stderr: "Not logged in\n" }),
      "sign-in-required",
    ],
    [
      ok({
        stdout: "",
        stderr: "Logged in using an API key - test-masked-key",
      }),
      "sign-in-required",
    ],
    [ok({ stdout: "", stderr: "unexpected private output" }), "unavailable"],
    [err({ kind: "timed-out", timeoutMs: 5000 }), "unavailable"],
    [err({ kind: "not-spawnable", message: "private path" }), "unavailable"],
    [
      err({
        kind: "exited",
        code: 1,
        stdout: "",
        stderr: "private configuration error",
      }),
      "unavailable",
    ],
  ] as const)("maps supported CLI status to %s", async (result, state) => {
    const run = vi.fn().mockResolvedValue(result);
    const status = await createNativeLoginService({
      run,
      env: () => ({}),
    }).status();
    expect(status.state).toBe(state);
    expect(Number.isNaN(Date.parse(status.checkedAt))).toBe(false);
    expect(Object.keys(status).sort()).toEqual(["checkedAt", "state"]);
    expect(run).toHaveBeenCalledWith({
      command: ["/usr/local/bin/codex-chatgpt", "login", "status"],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
  });
});

// TEST_SCENARIO: Codex may use a configured credential directory. Status must follow the same current harness environment instead of a stale runtime environment.
it("checks the latest Codex credential environment on every request", async () => {
  const run = vi
    .fn()
    .mockResolvedValue(ok({ stdout: "", stderr: "Logged in using ChatGPT\n" }));
  let env = { CODEX_HOME: "/fixture/native-account-a" };
  const service = createNativeLoginService({ run, env: () => env });
  await service.status();
  expect(run.mock.calls[0]?.[0]).toMatchObject({
    env: { CODEX_HOME: "/fixture/native-account-a" },
  });
  env = { CODEX_HOME: "/fixture/native-account-b" };
  await service.status();
  expect(run.mock.calls[1]?.[0]).toMatchObject({
    env: { CODEX_HOME: "/fixture/native-account-b" },
  });
});
