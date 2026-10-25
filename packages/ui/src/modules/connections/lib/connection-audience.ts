import {
  type SharedChannel,
  sharedChannelsTitle,
} from "../../sandboxes/lib/shared-channels.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Who besides the owner can ask an agent to use
 * its connections with the owner's access: its Agent Editors, and everyone in
 * the channels and group chats it is bound to. `channels` is null while they
 * are not known yet. Each of the two has its own "Don't show again" on the
 * warning that comes with adding a connection; a warning that names both
 * shows while either is still on, and turns off only the ones it named.
 */
export interface ConnectionAudience {
  editors: readonly string[];
  channels: readonly SharedChannel[] | null;
}

export type AudienceKind = "editors" | "channels";

export const hasAudience = ({ editors, channels }: ConnectionAudience) =>
  editors.length > 0 || (channels?.length ?? 0) > 0;

export function audiencesToWarn(
  { editors, channels }: ConnectionAudience,
  dismissed: (kind: AudienceKind) => boolean,
): AudienceKind[] {
  const named: AudienceKind[] = [
    ...(editors.length > 0 ? (["editors"] as const) : []),
    ...(channels === null || channels.length > 0
      ? (["channels"] as const)
      : []),
  ];
  return named.filter((kind) => !dismissed(kind));
}

export function noticeAudience(
  { editors, channels }: ConnectionAudience,
  dismissed: (kind: AudienceKind) => boolean,
): ConnectionAudience | null {
  const audience = {
    editors: dismissed("editors") ? editors : [],
    channels: dismissed("channels") ? (channels ?? []) : [],
  };
  return hasAudience(audience) ? audience : null;
}

const editorsTitle = (editors: readonly string[]) =>
  editors.length === 1 ? (editors[0] ?? "") : `${editors.length} editors`;

export function sharedConnectionTitle({
  editors,
  channels,
}: ConnectionAudience): string {
  if (editors.length === 0 && channels === null)
    return "This connection may be shared with a Slack or Telegram chat";
  const audiences = [
    ...(editors.length > 0 ? [editorsTitle(editors)] : []),
    ...(channels?.length ? [sharedChannelsTitle(channels)] : []),
  ];
  return `This connection will be shared with ${audiences.join(" and ")}`;
}
