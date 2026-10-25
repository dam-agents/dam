import type { ProfileWithUsage } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: picking a profile for a channel (D91). A profile
 * the agent can run is saved as it is; one whose provider the owner holds and
 * the agent does not is attached first, the same one-click the chat picker's
 * "Connect this provider" gives, and is saved only if that attach worked — so a
 * channel never names a profile whose every later turn would be refused (R3).
 */
export async function saveChannelProfile(input: {
  profile: ProfileWithUsage;
  attach: (profile: ProfileWithUsage) => Promise<boolean>;
  save: (profileId: string) => void;
}): Promise<boolean> {
  if (input.profile.availability?.attachable === true) {
    if (!(await input.attach(input.profile))) return false;
  }
  input.save(input.profile.id);
  return true;
}
