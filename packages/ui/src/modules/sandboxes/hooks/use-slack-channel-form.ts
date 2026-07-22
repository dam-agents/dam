import { useState } from "react";

import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
  useUpdateAgent,
} from "../../agents/api/mutations.js";

type SlackChannel = Extract<AgentView["channels"][number], { type: "slack" }>;

export type SlackAccessMode = "person-scoped" | "shared";

/** Local edit state plus the connect/disconnect/reconnect orchestration for
 *  one agent's Slack binding. Seeds from the current binding; the consumer
 *  remounts it (via key) when the binding changes out-of-band. */
export function useSlackChannelForm(agent: AgentView | undefined) {
  const slackChannel = agent?.channels.find(
    (c): c is SlackChannel => c.type === "slack",
  );
  const bound = !!slackChannel;

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();
  const updateAgent = useUpdateAgent();

  const [enabled, setEnabled] = useState(bound);
  const [channelId, setChannelId] = useState(
    slackChannel?.slackChannelId ?? "",
  );
  const [mode, setMode] = useState<SlackAccessMode>(
    slackChannel?.mode ?? "person-scoped",
  );
  const [ambient, setAmbient] = useState(slackChannel?.ambient ?? false);
  const [users, setUsers] = useState<string[]>(agent?.allowedUserEmails ?? []);
  const [userInput, setUserInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const channelIdError =
    submitted && enabled && !channelId.trim()
      ? "Enter the Slack channel ID."
      : undefined;

  const touch = <T>(set: (v: T) => void) => {
    return (v: T) => {
      set(v);
      setDirty(true);
    };
  };

  const addUser = () => {
    const v = userInput.trim();
    if (!v || users.includes(v)) return;
    setUsers((prev) => [...prev, v]);
    setUserInput("");
    setDirty(true);
  };

  const removeUser = (u: string) => {
    setUsers((prev) => prev.filter((x) => x !== u));
    setDirty(true);
  };

  const save = async () => {
    if (!agent) return;
    setSubmitted(true);
    if (enabled && !channelId.trim()) return;
    setSaving(true);
    try {
      const id = channelId.trim();
      const connectPayload = {
        id: agent.id,
        slackChannelId: id,
        ...(mode === "shared" ? { mode } : {}),
        ...(mode === "shared" && ambient ? { ambient: true } : {}),
      };
      if (enabled && !slackChannel) {
        await connectSlack.mutateAsync(connectPayload);
      } else if (!enabled && slackChannel) {
        await disconnectSlack.mutateAsync({ id: agent.id });
      } else if (
        enabled &&
        slackChannel &&
        id !== slackChannel.slackChannelId
      ) {
        await disconnectSlack.mutateAsync({ id: agent.id });
        await connectSlack.mutateAsync(connectPayload);
      } else if (
        enabled &&
        slackChannel &&
        mode === "shared" &&
        ambient !== (slackChannel.ambient ?? false)
      ) {
        // Ambient is mutable (unlike mode): a same-mode re-connect updates
        // the existing binding in place.
        await connectSlack.mutateAsync({
          id: agent.id,
          slackChannelId: slackChannel.slackChannelId,
          mode: "shared",
          ...(ambient ? { ambient: true } : {}),
        });
      }
      await updateAgent.mutateAsync({
        id: agent.id,
        allowedUserEmails: users,
      });
      setDirty(false);
      setSubmitted(false);
    } finally {
      setSaving(false);
    }
  };

  return {
    bound,
    enabled,
    setEnabled: touch(setEnabled),
    channelId,
    setChannelId: touch(setChannelId),
    channelIdError,
    mode,
    setMode: touch(setMode),
    ambient,
    setAmbient: touch(setAmbient),
    users,
    userInput,
    setUserInput,
    addUser,
    removeUser,
    saving,
    dirty,
    save,
  };
}
