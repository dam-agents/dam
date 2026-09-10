import {
  NOTIFICATION_TYPES,
  type NotificationItem,
  type NotificationType,
} from "./notification-types.js";

export interface NotificationFilters {
  types: ReadonlySet<NotificationType>;
  agents: ReadonlySet<string>;
}

export function defaultFilters(
  agentIds: readonly string[],
): NotificationFilters {
  return {
    types: new Set(NOTIFICATION_TYPES),
    agents: new Set(agentIds),
  };
}

export function isFiltered(
  filters: NotificationFilters,
  allAgentIds: readonly string[],
): boolean {
  if (filters.types.size < NOTIFICATION_TYPES.length) return true;
  if (filters.agents.size < allAgentIds.length) return true;
  return false;
}

export function applyFilters(
  items: readonly NotificationItem[],
  filters: NotificationFilters,
): NotificationItem[] {
  return items.filter(
    (item) => filters.types.has(item.type) && filters.agents.has(item.agentId),
  );
}

export function countByType(
  items: readonly NotificationItem[],
): Map<NotificationType, number> {
  const counts = new Map<NotificationType, number>();
  for (const item of items) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }
  return counts;
}

export function countByAgent(
  items: readonly NotificationItem[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.agentId, (counts.get(item.agentId) ?? 0) + 1);
  }
  return counts;
}

export function hiddenCount(
  all: readonly NotificationItem[],
  visible: readonly NotificationItem[],
): number {
  return all.length - visible.length;
}
