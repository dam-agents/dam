import type { PullRequestLink } from "agent-runtime-api";
import { match } from "ts-pattern";

import type { BadgeProps } from "@/components/ui/badge";

export interface PullRequestStatus {
  variant: NonNullable<BadgeProps["variant"]>;
  label: string | null;
  struck: boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: how a repository badge in the sessions list shows where its pull request stands, the way Claude Code colors its pull request indicator: gray for a draft, yellow while review is pending, green once approved, red for changes requested, purple once merged. A closed pull request is red as on GitHub, and struck through so it is not read as changes requested; merge conflicts show over the review color. The label names the state for the tooltip, so the color is not the only signal; a runtime that reports no state keeps the muted badge.
export function pullRequestStatus(link: PullRequestLink): PullRequestStatus {
  if (link.state === undefined)
    return { variant: "muted", label: null, struck: false };
  const review = match(link.state)
    .with("draft", () => ({ variant: "muted" as const, label: "Draft" }))
    .with("pending", () => ({
      variant: "pending" as const,
      label: "Review pending",
    }))
    .with("approved", () => ({
      variant: "success" as const,
      label: "Approved",
    }))
    .with("changes-requested", () => ({
      variant: "danger" as const,
      label: "Changes requested",
    }))
    .with("merged", () => ({ variant: "template" as const, label: "Merged" }))
    .with("closed", () => ({ variant: "danger" as const, label: "Closed" }))
    .exhaustive();
  const struck = link.state === "closed";
  return link.conflicts && link.state !== "merged" && !struck
    ? {
        variant: "conflict",
        label: `Merge conflicts · ${review.label}`,
        struck,
      }
    : { ...review, struck };
}
