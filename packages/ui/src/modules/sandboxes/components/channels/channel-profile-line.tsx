import { ProfilePicker } from "../../../profiles/components/profile-picker.js";
import { useSetChannelProfile } from "../../api/channel-profile.js";

export type ChannelKey = {
  type: "slack" | "telegram";
  slackChannelId?: string;
  conversationId?: string;
};

/** UNIT_BOUNDARY_DESCRIPTION: the profile a channel's turns run on, on its own row (D91); a channel that names none still follows the agent's chat default. */
export function ChannelProfileLine({
  agentId,
  channel,
  profileId,
  readOnly = false,
}: {
  agentId: string;
  channel: ChannelKey;
  profileId: string | null;
  readOnly?: boolean;
}) {
  const setProfile = useSetChannelProfile(agentId);
  return (
    <ProfilePicker
      agentId={agentId}
      label="Runs on"
      value={profileId}
      placeholder="the agent's chat default"
      disabled={readOnly || setProfile.isPending}
      onPick={(profile) =>
        setProfile.mutate({ ...channel, profileId: profile.id })
      }
      testId="channel-profile"
    />
  );
}
