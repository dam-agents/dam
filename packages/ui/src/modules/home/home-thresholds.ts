export const SEVERITY_ELEVATED_MS = 1 * 60 * 60 * 1000; // 1h
export const SEVERITY_HIGH_MS = 4 * 60 * 60 * 1000; // 4h
export const SEVERITY_CRITICAL_MS = 8 * 60 * 60 * 1000; // 8h

export const DIGEST_MAX_WINDOW_DAYS = 30;
export const DIGEST_MIN_WINDOW_MINUTES = 30;

export const POLL_INTERVAL_MS = 30 * 1000; // 30s
export const DURATION_TICK_MS = 30 * 1000; // 30s

export const SPEND_ANOMALY_MULTIPLIER = 3;
export const SPEND_ANOMALY_MIN_USD = 10;
export const SPEND_CAP_WARN_PCT = 0.8;

export const RESULT_SIGNIFICANT_DELTA = 0.05;
export const RELATIVE_TIME_CUTOFF_DAYS = 7;

export const SECTION_COLLAPSE_LIMITS = {
  blocked: 5,
  ready: 5,
  results: 4,
  learnings: 4,
  running: 5,
  agents: 8,
} as const;
