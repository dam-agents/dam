// TEST_OVERVIEW: Device authorization is an explicit fixed command, admitted only for native Codex. An unknown action or a revoked provider cannot become another command.
import { describe, expect, it } from "vitest";
import { nativeLoginCommand } from "../../modules/native-login/domain/login-command.js";

describe("device login terminal command", () => {
  it("starts only the native device-login command", () => {
    expect(
      nativeLoginCommand({
        action: "chatgpt-login",
        harness: "codex",
        chatgptGranted: true,
      }),
    ).toEqual(["/usr/local/bin/codex-chatgpt", ["login", "--device-auth"]]);
  });
  it.each([
    { action: "arbitrary-command", harness: "codex", chatgptGranted: true },
    { action: "chatgpt-login", harness: "claude-code", chatgptGranted: true },
    { action: "chatgpt-login", harness: "codex", chatgptGranted: false },
  ])("refuses an action outside the native grant", (input) => {
    expect(nativeLoginCommand(input)).toBeNull();
  });
});
