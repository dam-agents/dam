import { GitCompare, RefreshCw, WifiOff } from "lucide-react";
import { Renew } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

/**
 * Mock-only showcase: renders every update/upgrade UI pattern from the codebase
 * side-by-side so we can review consistency. Accessed via /explore/update-patterns.
 */
export function UpdatePatternsShowcase() {
  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-10 space-y-10">
      <div>
        <h1 className="mb-1 text-[22px] font-semibold text-foreground">
          Update / Upgrade UI Patterns
        </h1>
        <p className="text-[14px] text-muted-foreground">
          Every pattern currently in the UI that signals updates, upgrades, or
          drift to the user. Review for consistency.
        </p>
      </div>

      {/* 1. Updates Available Banner (list view) */}
      <PatternSection
        title="1. Updates Available Banner"
        location="agents/components/updates-available-banner.tsx"
        description="Shown at the top of the sandboxes list when one or more sandboxes have a template update. Grey background, Renew icon, outline 'Update all' button."
      >
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3">
          <Renew size={20} className="shrink-0 text-muted-foreground" />
          <p className="flex-1 text-[14px] text-muted-foreground">
            <strong className="font-semibold text-foreground">
              2 sandboxes are out of date.
            </strong>{" "}
            claude-code-main and gemini-data-pipeline changed upstream since they
            were installed.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
          >
            <Renew size={16} className="shrink-0" />
            Update all
          </Button>
        </div>
      </PatternSection>

      {/* 2. Agent Row Button */}
      <PatternSection
        title="2. Agent Row Button"
        location="agents/components/agent-row.tsx"
        description="A ghost button with accent text inline with the row actions. Clickable to trigger the upgrade for that specific sandbox."
      >
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex-1">
            <p className="text-[15px] font-medium text-foreground">
              claude-code-main
            </p>
            <p className="text-[13px] text-muted-foreground">
              Primary development sandbox running Claude Code
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
          >
            <Renew size={14} className="shrink-0" />
            Update
          </Button>
        </div>
      </PatternSection>

      {/* 3. Sandbox Home Header Button */}
      <PatternSection
        title="3. Sandbox Home Header Button"
        location="sandboxes/components/sandbox-home-header.tsx"
        description="Ghost button with accent text and Renew icon in the page header actions. Visible when viewing a single sandbox that has a template update."
      >
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
          >
            <Renew className="size-4" />
            Update
          </Button>
        </div>
      </PatternSection>

      {/* 4. Template Update Notice (settings section) */}
      <PatternSection
        title="4. Template Update Notice (Settings)"
        location="sandboxes/components/template-update-notice.tsx"
        description="A muted Callout under the Image field in sandbox settings. Shows the new image tag and a ghost 'Upgrade' button."
      >
        <Callout
          tone="muted"
          size="sm"
          inset
          className="flex flex-wrap items-center gap-x-10 gap-y-1.5"
        >
          <p className="min-w-0 flex-1 basis-[280px] text-[13px] leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground/80">
              Update available.
            </strong>{" "}
            The template now ships{" "}
            <span className="break-all font-mono text-[12px] text-foreground">
              ghcr.io/anthropics/claude-code:1.0.21
            </span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
          >
            Upgrade
          </Button>
        </Callout>
      </PatternSection>

      {/* 5. Skill Row Drift Pill */}
      <PatternSection
        title="5. Skill Row Drift Pill"
        location="sandboxes/components/skills/skill-row.tsx"
        description="An info-toned pill with RefreshCw icon next to the skill name. Appears when an installed skill's content differs from its source. Optionally accompanied by a GitCompare link."
      >
        <div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-medium text-foreground">
                code-review
              </p>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-light px-2 py-0.5 text-[11px] font-medium text-info transition-opacity hover:opacity-80"
              >
                <RefreshCw size={11} /> Update
              </button>
              <span className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
                <GitCompare size={13} />
              </span>
            </div>
            <p className="truncate text-[13px] text-muted-foreground">
              Automated code review skill with configurable rules
            </p>
          </div>
        </div>
      </PatternSection>

      {/* 6. Contribution Failures Badge */}
      <PatternSection
        title="6. Contribution Failures Badge"
        location="agents/components/contribution-failures-badge.tsx"
        description="A warning-toned badge indicating install failures on a sandbox. Not strictly an 'update' but signals degraded state requiring action."
      >
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex-1">
            <p className="text-[15px] font-medium text-foreground">
              gemini-data-pipeline
            </p>
            <p className="text-[13px] text-muted-foreground">
              Data pipeline automation with Gemini CLI
            </p>
          </div>
          <Badge variant="warning" title="skills: failed to install 'lint-rules'">
            1 install failed
          </Badge>
        </div>
      </PatternSection>

      {/* 7. Connection Banner */}
      <PatternSection
        title="7. Connection Banner (reference)"
        location="components/connection-banner.tsx"
        description="A fixed warning bar for connectivity issues. Not an update pattern per se, but uses a similar urgency/warning visual language."
      >
        <div className="flex h-11 items-center justify-center gap-2 rounded-xl border border-warning bg-warning-light px-5 text-[13px] font-semibold text-warning">
          <WifiOff size={14} />
          <span>
            You're offline — updates will resume when your connection returns.
          </span>
        </div>
      </PatternSection>
    </div>
  );
}

function PatternSection({
  title,
  location,
  description,
  children,
}: {
  title: string;
  location: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
        <p className="text-[14px] text-muted-foreground">{description}</p>
        <p className="mt-0.5 font-mono text-[12px] text-muted-foreground/70">
          {location}
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-border p-4">
        {children}
      </div>
    </section>
  );
}
