import { match } from "ts-pattern";

import type { BadgeProps } from "@/components/ui/badge";

import type { PullRequestLink } from "../types.js";

export interface PullRequestStatus {
  variant: NonNullable<BadgeProps["variant"]>;
  label: string | null;
  struck: boolean;
}

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
