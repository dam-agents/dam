import type { HarnessFamily } from "api-server-api";

const ONBOARD_COMMAND_NAME = "wiki-onboard";

const PLAIN_COMMAND = `/${ONBOARD_COMMAND_NAME}`;

const ONBOARD_COMMAND_BY_HARNESS: Record<HarnessFamily, string> = {
  "claude-code": PLAIN_COMMAND,
  codex: `/prompts:${ONBOARD_COMMAND_NAME}`,
  pi: PLAIN_COMMAND,
  bob: PLAIN_COMMAND,
};

export function onboardCommandFor(harness: HarnessFamily | undefined): string {
  return harness === undefined
    ? PLAIN_COMMAND
    : ONBOARD_COMMAND_BY_HARNESS[harness];
}
