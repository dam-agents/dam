import {
  SESSION_CATEGORIES,
  type SessionCategory,
  sessionCategory,
} from "../../sessions/lib/session-category.js";
import type { FeedItem } from "./feed-item.js";

export type FeedState = "in-progress" | "unread";

export const FEED_STATES: readonly FeedState[] = ["in-progress", "unread"];

export const FEED_STATE_LABELS: Record<FeedState, string> = {
  "in-progress": "In progress",
  unread: "Unread",
};

export const ALL_STATES: ReadonlySet<FeedState> = new Set(FEED_STATES);
export const ALL_CATEGORIES: ReadonlySet<SessionCategory> = new Set(
  SESSION_CATEGORIES,
);

function matchesState(item: FeedItem, states: ReadonlySet<FeedState>): boolean {
  return states.has(item.kind);
}

function matchesCategory(
  item: FeedItem,
  categories: ReadonlySet<SessionCategory>,
): boolean {
  return categories.has(sessionCategory(item.session));
}

export function filterFeed(
  items: readonly FeedItem[],
  includedStates: ReadonlySet<FeedState>,
  includedCategories: ReadonlySet<SessionCategory>,
): FeedItem[] {
  const allStates = includedStates.size === ALL_STATES.size;
  const allCategories = includedCategories.size === ALL_CATEGORIES.size;

  return items.filter((item) => {
    if (!allStates && !matchesState(item, includedStates)) return false;
    if (!allCategories && !matchesCategory(item, includedCategories))
      return false;
    return true;
  });
}

export function feedStats(items: readonly FeedItem[]): {
  running: number;
  toReview: number;
} {
  return {
    running: items.filter((i) => i.kind === "in-progress").length,
    toReview: items.filter((i) => i.kind === "unread").length,
  };
}

export interface FeedEmpty {
  title: string;
  message: string;
  tone: "clear" | "filtered";
}

export function emptyStateFor(options: {
  allStatesExcluded: boolean;
  allCategoriesExcluded: boolean;
  noRunningAgents: boolean;
  unreadableAgents?: number;
}): FeedEmpty {
  if (options.allStatesExcluded || options.allCategoriesExcluded) {
    return {
      title: "Nothing included",
      message: "Every filter is off. Turn some on to see activity.",
      tone: "filtered",
    };
  }
  if (options.unreadableAgents) {
    const one = options.unreadableAgents === 1;
    return {
      title: one ? "One agent did not answer" : "Some agents did not answer",
      message: one
        ? "An agent could not be read, so its sessions are missing here."
        : `${options.unreadableAgents} agents could not be read, so their sessions are missing here.`,
      tone: "filtered",
    };
  }
  if (options.noRunningAgents) {
    return {
      title: "Nothing running",
      message:
        "Unread and in-progress work show up here while an agent is running.",
      tone: "clear",
    };
  }
  return {
    title: "All clear",
    message: "Nothing waiting for review. You're all caught up.",
    tone: "clear",
  };
}
