import { describe, expect, test } from "vitest";
import { envsAfterUngrant } from "../../modules/agents/utils/connection-env-helpers.js";
import type { AppConnectionView, EnvVar } from "api-server-api";

// These two tests lock in the *non-obvious* invariants of the ungrant path.
// Everything else in `connection-env-helpers.ts` is filter/map that restates
// the code itself — tests for that would only duplicate the implementation.

function app(
  envMappings?: AppConnectionView["envMappings"],
): Pick<AppConnectionView, "envMappings"> {
  return { envMappings };
}

const mapping = (envName: string, placeholder = "humr:sentinel") => ({
  envName,
  placeholder,
});

describe("envsAfterUngrant — non-obvious invariants", () => {
  test("keeps an entry another still-granted app also declares (shared env)", () => {
    // Gmail and Drive both declare GOOGLE_WORKSPACE_CLI_TOKEN. Ungranting
    // Gmail while Drive is still granted must not drop the env. Without the
    // `stillNeededNames` guard, a naive filter would silently delete it.
    const envs: EnvVar[] = [{ name: "X", value: "humr:sentinel" }];
    const out = envsAfterUngrant(
      envs,
      app([mapping("X")]),
      [app([mapping("X")])],
    );
    expect(out).toEqual(envs);
  });

  test("treats a placeholder change (sentinel rotation) as 'edited' — keeps the entry", () => {
    // An agent env populated under the old placeholder shouldn't be silently
    // deleted after the sentinel is rotated. The value-equality check is
    // what protects this — dropping it would cause data loss post-upgrade.
    const envs: EnvVar[] = [{ name: "X", value: "humr:sentinel" }];
    const out = envsAfterUngrant(envs, app([mapping("X", "humr:sentinel-v2")]), []);
    expect(out).toEqual(envs);
  });
});
