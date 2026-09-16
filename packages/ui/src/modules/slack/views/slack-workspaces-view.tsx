import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

import { getBrand } from "../../../brand.js";
import { useCopy } from "../../../hooks/use-copy.js";
import {
  useSlackInvitationLink,
  useStartSlackInstall,
} from "../api/mutations.js";

export function SlackWorkspacesView() {
  const brandShort = getBrand().short;
  const start = useStartSlackInstall();
  const invitation = useSlackInvitationLink();
  const { copy, state: copyState } = useCopy();

  const copyLabel =
    copyState === "copied"
      ? "Link copied"
      : copyState === "failed"
        ? "Couldn't copy"
        : "Copy an invitation link";

  return (
    <div className="anim-in">
      <PageHeader
        title="Slack workspaces"
        description={`Connect another Slack workspace so its channels can reach ${brandShort} agents.`}
      />

      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          An admin of the workspace you are adding has to approve {brandShort}{" "}
          in Slack. Go there yourself if you administer that workspace, or copy
          an invitation link and send it to someone who does — they need no{" "}
          {brandShort} account. A link is good for 24 hours and works once.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Whoever approves it needs to be on the VPN, because Slack sends their
          browser back here afterwards. The workspace this platform was set up
          with is already connected and is unaffected.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? "Opening Slack…" : "Connect a workspace"}
          </Button>
          <Button
            variant="outline"
            onClick={() => copy(() => invitation.mutateAsync())}
            disabled={invitation.isPending}
          >
            {invitation.isPending ? "Creating…" : copyLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
