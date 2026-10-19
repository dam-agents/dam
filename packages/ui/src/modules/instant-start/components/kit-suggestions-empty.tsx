import { ArrowRight } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { BrowsePacksModal } from "../../packs/components/browse-packs-modal.js";

const SUGGESTED = [
  {
    id: "code-guardian",
    name: "Code Reviewer",
    tagline: "Automated PR review so nothing goes stale",
  },
  {
    id: "research-agent",
    name: "Research Agent",
    tagline: "Deep dives into any topic with structured reports",
  },
  {
    id: "slack-responder",
    name: "Slack Responder",
    tagline: "Monitors channels and responds automatically",
  },
];

export function KitSuggestionsEmpty() {
  const [browseOpen, setBrowseOpen] = useState(false);

  return (
    <div className="mt-6 w-full max-w-md">
      <p className="mb-3 text-sm font-medium text-muted-foreground">
        Or start from a pack
      </p>
      <div className="flex flex-col gap-2">
        {SUGGESTED.map((pack) => (
          <button
            key={pack.id}
            type="button"
            onClick={() => setBrowseOpen(true)}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/20"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{pack.name}</p>
              <p className="text-sm text-muted-foreground truncate">
                {pack.tagline}
              </p>
            </div>
            <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => setBrowseOpen(true)}
      >
        Browse all packs
      </Button>
      {browseOpen && (
        <BrowsePacksModal
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onSelect={() => setBrowseOpen(false)}
        />
      )}
    </div>
  );
}

export function KitSuggestionsCompact() {
  const [browseOpen, setBrowseOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => setBrowseOpen(true)}
      >
        <ArrowRight size={16} />
        Browse packs
      </Button>
      {browseOpen && (
        <BrowsePacksModal
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onSelect={() => setBrowseOpen(false)}
        />
      )}
    </>
  );
}
