// TEST_OVERVIEW: Each CLI module turns its own service failures into one sentence on stderr and one named exit code, so a wrapper script keeps branching on the same numbers and a user keeps reading the same text. The describes here are the whole mapping: a module's failure kind, or a transport/auth failure, becomes exactly the sentence and code the module's commands print and exit with.
import { describe, expect, it } from "vitest";
import {
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SCHEDULE_NOT_FOUND,
} from "../modules/shared/exit-codes.js";
import { describeResolveError } from "../modules/agent/commands/errors.js";
import { describeScheduleError } from "../modules/schedule/domain/errors.js";
import { describeChannelError } from "../modules/channel/domain/errors.js";
import { serviceErrorDescription } from "../modules/shared/trpc/print.js";

const HOST = "http://dam.localhost:4444";

describe("service error descriptions", () => {
  it("names the schedule a command could not find, by the id it asked for", () => {
    expect(
      describeScheduleError(
        { kind: "schedule-not-found", id: "sched-1" },
        HOST,
      ),
    ).toEqual({
      stderr: "error: schedule not found: sched-1\n",
      exitCode: EXIT_SCHEDULE_NOT_FOUND,
    });
  });

  it("passes a schedule's invalid input through with the server's sentence", () => {
    expect(
      describeScheduleError(
        { kind: "invalid-input", message: "cron is not valid" },
        HOST,
      ),
    ).toEqual({
      stderr: "error: cron is not valid\n",
      exitCode: EXIT_INVALID_INPUT,
    });
  });

  it("describes a channel conflict and its precondition by the invalid-input code", () => {
    expect(
      describeChannelError(
        { kind: "channel-conflict", message: "taken" },
        HOST,
      ),
    ).toEqual({
      stderr: "error: this agent is already connected to that Slack channel\n",
      exitCode: EXIT_INVALID_INPUT,
    });
    expect(
      describeChannelError(
        { kind: "channel-precondition", message: "no such channel" },
        HOST,
      ),
    ).toEqual({
      stderr: "error: no such channel\n",
      exitCode: EXIT_INVALID_INPUT,
    });
  });

  it("names a missing agent by the ref the user typed, and lists the ambiguous matches", () => {
    expect(
      describeResolveError(
        { kind: "not-found", ref: "scout", via: "name" },
        HOST,
      ),
    ).toEqual({
      stderr: 'error: no agent named "scout"\n',
      exitCode: EXIT_AGENT_NOT_RESOLVED,
    });
    expect(
      describeResolveError(
        {
          kind: "ambiguous",
          ref: "scout",
          matches: [
            { id: "agent-1", name: "scout" },
            { id: "agent-2", name: "scout" },
          ],
        },
        HOST,
      ),
    ).toEqual({
      stderr:
        'error: multiple agents named "scout":\n  - `agent-1`\n  - `agent-2`\nhint: specify by id instead\n',
      exitCode: EXIT_AGENT_NOT_RESOLVED,
    });
  });

  it("falls back to the shared transport sentence and to the auth hint", () => {
    expect(
      serviceErrorDescription(
        { kind: "transport", reason: "ECONNREFUSED" },
        HOST,
      ),
    ).toEqual({
      stderr: `error: cannot reach server \`${HOST}\`: ECONNREFUSED\n`,
      exitCode: EXIT_RUNTIME_FAILURE,
    });
    expect(
      serviceErrorDescription(
        {
          kind: "transport",
          reason: "nope",
          serverCode: "PRECONDITION_FAILED",
        },
        HOST,
      ),
    ).toEqual({ stderr: "error: nope\n", exitCode: EXIT_RUNTIME_FAILURE });
    expect(
      serviceErrorDescription(
        { kind: "auth-required", reason: "expired" },
        HOST,
      ),
    ).toEqual({
      stderr:
        "error: not authenticated: expired\nhint: run `dam auth login` first\n",
      exitCode: EXIT_RUNTIME_FAILURE,
    });
  });
});
