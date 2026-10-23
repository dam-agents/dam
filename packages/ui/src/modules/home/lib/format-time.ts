import { RELATIVE_TIME_CUTOFF_DAYS } from "../home-thresholds.js";

/**
 * Format a duration in milliseconds as a human-readable string.
 * < 60s → "45s", < 60m → "14m", < 24h → "2h 14m", ≥ 24h → "1d 6h"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Format a relative timestamp.
 * < 60s → "just now", < 60m → "14m ago", < 24h → "3h ago",
 * < 7d → "4d ago", ≥ 7d → absolute date "12 Jun", different year → "12 Jun 2024"
 */
export function formatRelative(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < RELATIVE_TIME_CUTOFF_DAYS) return `${days}d ago`;

  const date = new Date(iso);
  const now = new Date();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  if (date.getFullYear() !== now.getFullYear()) {
    return `${day} ${month} ${date.getFullYear()}`;
  }
  return `${day} ${month}`;
}

/**
 * Format the absolute local datetime for title attributes.
 */
export function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format digestSince for the header.
 * Same day → "Since 9:14 AM today"
 * Yesterday → "Since 4:12 PM yesterday"
 * Within 7 days → "Since Tuesday 4:12 PM"
 * Older → "Since 12 Jun"
 */
export function formatDigestSince(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (diffDays === 0 && date.getDate() === now.getDate()) {
    return `Since ${time} today`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && diffDays <= 1) {
    return `Since ${time} yesterday`;
  }

  if (diffDays < RELATIVE_TIME_CUTOFF_DAYS) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
    return `Since ${weekday} ${time}`;
  }

  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `Since ${date.getDate()} ${month}`;
}
