import { EXIT_INVALID_INPUT } from "../../shared/exit-codes.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a schedule names a profile by name or id on the
 * command line, and the api-server takes an id the caller owns; an unknown one
 * is refused here, before anything is written.
 */
export async function profileOrExit(
  deps: {
    findProfile: (
      host: string,
      ref: string,
    ) => Promise<{ id: string; name: string } | null>;
  },
  host: string,
  ref: string | undefined,
): Promise<string | null> {
  if (ref === undefined) return null;
  const profile = await deps.findProfile(host, ref);
  if (!profile) {
    process.stderr.write(
      `error: unknown profile: ${ref}\nhint: run \`dam profile list\` to see names and ids\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  return profile.id;
}
