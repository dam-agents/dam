import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { emitToast } from "../../../lib/toast.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { parseRoute } from "../../platform/lib/routes.js";
import { useDeleteSlackPost } from "../api/mutations.js";

const POST_REF_PARAM = "m";

function readLinkedPost(): { agentId: string; postRef: string } | null {
  const postRef = new URLSearchParams(window.location.search).get(
    POST_REF_PARAM,
  );
  const route = parseRoute(window.location.pathname);
  if (!postRef || route.view !== "chat") return null;
  return { agentId: route.agent, postRef };
}

function forgetPostRef(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(POST_REF_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

export function SlackPostDeleteDialog({ agentId }: { agentId: string | null }) {
  const [linkedPost, setLinkedPost] = useState(readLinkedPost);
  const [reason, setReason] = useState("");
  const agents = useAgentsList();
  const deletePost = useDeleteSlackPost();

  const owned = agents.some((a) => a.id === linkedPost?.agentId);
  if (!linkedPost || linkedPost.agentId !== agentId || !owned) return null;

  const close = () => {
    forgetPostRef();
    setLinkedPost(null);
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      kind="destructive"
      title="Delete this post from Slack?"
      description={
        <div className="space-y-3">
          <p>
            It is removed for everyone in the conversation. The session
            transcript here keeps what the agent wrote.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="slack-post-delete-reason">
              Tell the agent why (optional)
            </Label>
            <Textarea
              id="slack-post-delete-reason"
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. That channel is public, don't share customer names there."
            />
          </div>
        </div>
      }
      confirmLabel="Delete"
      onConfirm={() => {
        const { postRef } = linkedPost;
        close();
        deletePost.mutate(
          { agentId: linkedPost.agentId, postRef, reason: reason.trim() },
          {
            onSuccess: ({ agentWillBeTold }) =>
              emitToast({
                kind: "success",
                message: agentWillBeTold
                  ? "Post deleted from Slack. The agent will be told."
                  : "Post deleted from Slack.",
              }),
          },
        );
      }}
    />
  );
}
