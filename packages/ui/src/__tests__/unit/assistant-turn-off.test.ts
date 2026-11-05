// TEST_OVERVIEW: Turning the assistant off for one person is a delete, so it asks first: the dialog names the install's own assistant, and only a confirmation changes the flag. Cancel leaves the switch on and calls nothing.
import { describe, expect, it } from "vitest";

import {
  runTurnOffAssistant,
  TURN_OFF_TITLE,
  turnOffBody,
} from "../../modules/assistants/lib/turn-off-assistant.js";

function world(confirmed: boolean, opts: { fails?: boolean } = {}) {
  const steps: string[] = [];
  const reports: string[] = [];
  return {
    steps,
    reports,
    deps: {
      assistantName: "Dambledore",
      confirm: async (
        _body: string,
        title: string,
        options: { confirmLabel: string },
      ) => {
        steps.push(`confirm:${title}:${options.confirmLabel}`);
        return confirmed;
      },
      turnOff: async () => {
        steps.push("turn-off");
        if (opts.fails === true) throw new Error("the delete was refused");
      },
      reportFailure: (message: string) => {
        reports.push(message);
      },
    },
  };
}

describe("turning the assistant off", () => {
  // TEST_SCENARIO: the person confirms: the flag is switched off once, after the dialog.
  it("turns the flag off once the person confirms", async () => {
    const w = world(true);
    expect(await runTurnOffAssistant(w.deps)).toBe(true);
    expect(w.steps).toEqual([`confirm:${TURN_OFF_TITLE}:Turn off`, "turn-off"]);
  });

  // TEST_SCENARIO: cancel changes nothing at all — the switch stays on, because no flag change is called.
  it("calls nothing when the person cancels", async () => {
    const w = world(false);
    expect(await runTurnOffAssistant(w.deps)).toBe(false);
    expect(w.steps).toEqual([`confirm:${TURN_OFF_TITLE}:Turn off`]);
  });

  // TEST_SCENARIO: the delete could not finish — the owner's provisioning lock was held, or the server refused — so the flag is not switched, the switch stays on, and the person is told to try again.
  it("keeps the switch on and says so when the turn-off fails", async () => {
    const w = world(true, { fails: true });
    expect(await runTurnOffAssistant(w.deps)).toBe(false);
    expect(w.steps).toEqual([`confirm:${TURN_OFF_TITLE}:Turn off`, "turn-off"]);
    expect(w.reports).toEqual(["Couldn't turn off Dambledore. Try again."]);
  });

  // TEST_SCENARIO: the dialog says what turning it off deletes, naming the install's own assistant.
  it("says what turning it off deletes", () => {
    expect(turnOffBody("Dambledore")).toBe(
      "Turning off Dambledore deletes your assistant and its sessions and files.",
    );
  });
});
