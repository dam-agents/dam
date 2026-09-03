import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { getBrand } from "../../../brand.js";

export function BindSuccessPreviewView() {
  const brand = getBrand();
  const agentName = "Jamies-Bot";
  const channelTitle = "#design-dev";
  const [ambient, setAmbient] = useState(false);

  return (
    <div className="mx-auto w-full max-w-140 px-4 py-10 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <img src="/icons/slack.svg" alt="" width={32} height={32} />
        <h1 className="text-2xl font-semibold">
          {agentName} has been added to {channelTitle}
        </h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Mention{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">
          @{brand.name}
        </code>{" "}
        in the channel to use it. If the channel has more than one agent, add
        the name:{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">
          @{brand.name} {agentName}
        </code>
        .
        <br />
        <br />
        Disconnect anytime with{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">
          /{brand.short} unbind {agentName}
        </code>
        .
      </p>

      <button
        type="button"
        onClick={() => setAmbient((v) => !v)}
        className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left cursor-pointer transition-colors hover:bg-muted/40"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Ambient mode
          </span>
          <span className="text-sm text-muted-foreground">
            The agent reads along in the channel and may chime in without being
            mentioned when it can clearly help.
          </span>
        </span>
        <Switch
          className="mt-0.5 pointer-events-none"
          checked={ambient}
          onCheckedChange={setAmbient}
          label="Ambient mode"
        />
      </button>

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => window.location.assign("/")}
      >
        Back to Dashboard
      </Button>
    </div>
  );
}
