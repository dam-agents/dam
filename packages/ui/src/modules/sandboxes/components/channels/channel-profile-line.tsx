import { useProfiles } from "../../../profiles/api/queries.js";
import { ProfilePicker } from "../../../profiles/components/profile-picker.js";
import { useProfileAttach } from "../../../profiles/hooks/use-profile-attach.js";
import { useSetChannelProfile } from "../../api/channel-profile.js";
import { saveChannelProfile } from "../../lib/channel-profile-save.js";

export type ChannelKey = {
  type: "slack" | "telegram";
  slackChannelId?: string;
  conversationId?: string;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a channel's turns run on, on the
 * channel's own row (D91): every turn is resolved from it, and a channel that
 * carries none still follows the agent's chat default until someone picks one.
 * A pick whose provider the agent has not been granted attaches it first, so a
 * channel never names a profile its turns would refuse (R3).
 */
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
  const { data: profiles = [] } = useProfiles(agentId);
  const setProfile = useSetChannelProfile(agentId);
  const { attach, manage } = useProfileAttach(agentId);

  const save = (id: string) => setProfile.mutate({ ...channel, profileId: id });

  return (
    <ProfilePicker
      label="Runs on"
      profiles={profiles}
      value={profileId}
      placeholder="the agent's chat default"
      disabled={readOnly || setProfile.isPending}
      onPick={(profile) => void saveChannelProfile({ profile, attach, save })}
      onAttach={(profile) => void saveChannelProfile({ profile, attach, save })}
      onManage={manage}
      testId="channel-profile"
    />
  );
}
