/**
 * Digest summary — counts of what happened since the user's last visit.
 * Drives the summary line in the home header.
 */

import { useQuery } from "@tanstack/react-query";

import { POLL_INTERVAL_MS } from "./home-thresholds.js";

export interface DigestSummary {
  blocked: number;
  completed: number;
  newArtifacts: number;
  newLearnings: number;
  running: number;
}

// STUB: home.digestSummary
function makeFixture(since: string): DigestSummary {
  const age = Date.now() - Date.parse(since);
  const hours = age / 3_600_000;

  // Scale counts loosely with the window size for more realistic fixtures
  if (hours <= 1) {
    return {
      blocked: 1,
      completed: 0,
      newArtifacts: 0,
      newLearnings: 0,
      running: 3,
    };
  }
  if (hours <= 4) {
    return {
      blocked: 3,
      completed: 2,
      newArtifacts: 1,
      newLearnings: 0,
      running: 4,
    };
  }
  if (hours <= 12) {
    return {
      blocked: 4,
      completed: 5,
      newArtifacts: 2,
      newLearnings: 1,
      running: 3,
    };
  }
  // > 12h (overnight/multi-day)
  return {
    blocked: 6,
    completed: 8,
    newArtifacts: 4,
    newLearnings: 2,
    running: 2,
  };
}

export function useDigestSummary(digestSince: string) {
  // STUB: home.digestSummary
  return useQuery<DigestSummary>({
    queryKey: ["home", "digest-summary", digestSince],
    queryFn: () => Promise.resolve(makeFixture(digestSince)),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}
