import { useState } from "react";

import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
  useUpdateAgent,
} from "../../agents/api/mutations.js";

type SlackChannel = Extract<AgentView["channels"][number], { type: "slack" }>;

export type SlackAccessMode = "person-scoped" | "shared";

export function findSlackChannel(
  agent: AgentView | undefined,
): SlackChannel | undefined {
  return agent?.channels.find((c): c is SlackChannel => c.type === "slack");
}

/** Form state for the connect/edit Slack modal, seeded from the current
 *  binding. Saving orchestrates connect / rebind / ambient update plus the
 *  allowed-users patch, then reports completion via `onSaved`. */
export function useSlackChannelForm(agent: AgentView, onSaved: () => void) {
  const slackChannel = findSlackChannel(agent);
  const editing = !!slackChannel;

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();
  const updateAgent = useUpdateAgent();

  const [channelId, setChannelId] = useState(
    slackChannel?.slackChannelId ?? "",
  );
  const [mode, setMode] = useState<SlackAccessMode>(
    slackChannel?.mode ?? "person-scoped",
  );
  const [ambient, setAmbient] = useState(slackChannel?.ambient ?? false);
  const [users, setUsers] = useState<string[]>(agent.allowedUserEmails);
  const [userInput, setUserInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const channelIdError =
    submitted && !channelId.trim() ? "Enter the Slack channel ID." : undefined;

  const addUser = () => {
    const v = userInput.trim();
    if (!v || users.includes(v)) return;
    setUsers((prev) => [...prev, v]);
    setUserInput("");
  };

  const removeUser = (u: string) => {
    setUsers((prev) => prev.filter((x) => x !== u));
  };

  const save = async () => {
    setSubmitted(true);
    if (!channelId.trim()) return;
    setSaving(true);
    try {
      const id = channelId.trim();
      const connectPayload = {
        id: agent.id,
        slackChannelId: id,
        ...(mode === "shared" ? { mode } : {}),
        ...(mode === "shared" && ambient ? { ambient: true } : {}),
      };
      if (!slackChannel) {
        await connectSlack.mutateAsync(connectPayload);
      } else if (id !== slackChannel.slackChannelId) {
        // The mode is fixed per binding, so a channel change is a rebind.
        await disconnectSlack.mutateAsync({ id: agent.id });
        await connectSlack.mutateAsync(connectPayload);
      } else if (
        mode === "shared" &&
        ambient !== (slackChannel.ambient ?? false)
      ) {
        // Ambient is mutable (unlike mode): a same-mode re-connect updates
        // the existing binding in place.
        await connectSlack.mutateAsync(connectPayload);
      }
      await updateAgent.mutateAsync({
        id: agent.id,
        allowedUserEmails: users,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return {
    editing,
    channelId,
    setChannelId,
    channelIdError,
    mode,
    setMode,
    ambient,
    setAmbient,
    users,
    userInput,
    setUserInput,
    addUser,
    removeUser,
    saving,
    save,
  };
}
