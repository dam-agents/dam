import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

import { getBrand } from "../../../brand.js";
import { useStartSlackInstall } from "../api/mutations.js";

export function SlackWorkspacesView() {
  const brandShort = getBrand().short;
  const start = useStartSlackInstall();

  return (
    <div className="anim-in">
      <PageHeader
        title="Slack workspaces"
        description={`Connect another Slack workspace so its channels can reach ${brandShort} agents.`}
      />

      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          Slack asks an admin of the workspace you are adding to approve{" "}
          {brandShort}. Starting here sends you to Slack&rsquo;s consent screen
          — approve it yourself if you administer that workspace, or hand the
          link to someone who does. They need no {brandShort} account.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          The workspace this platform was set up with is already connected and
          is unaffected by anything you do here.
        </p>
        <Button
          className="mt-5"
          onClick={() => start.mutate()}
          disabled={start.isPending}
        >
          {start.isPending ? "Opening Slack…" : "Connect a workspace"}
        </Button>
      </Card>
    </div>
  );
}
