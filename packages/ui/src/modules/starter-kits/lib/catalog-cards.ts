import type { ConnectionTemplateView, StarterKitView } from "api-server-api";

import { connectionRequirements, describeAccepts } from "./setup.js";

export const CATEGORY_LABEL: Record<StarterKitView["category"], string> = {
  knowledge: "Knowledge",
  software: "Software",
  productivity: "Productivity",
  research: "Research",
};

export interface KitBadge {
  key: string;
  label: string;
  iconSlug?: string;
}

export function kitBadges(
  kit: Pick<
    StarterKitView,
    | "schedules"
    | "channels"
    | "connections"
    | "skills"
    | "skillsInKit"
    | "knowledgeBase"
  >,
  templates: readonly ConnectionTemplateView[],
  templateById: ReadonlyMap<string, ConnectionTemplateView>,
): KitBadge[] {
  const badges: KitBadge[] = [];

  if (kit.schedules.length > 0) {
    badges.push({
      key: "schedules",
      label: `${kit.schedules.length} ${kit.schedules.length === 1 ? "Schedule" : "Schedules"}`,
    });
  }

  for (const channel of kit.channels) {
    badges.push({
      key: `channel:${channel.type}`,
      label: channel.type === "slack" ? "Slack" : "Telegram",
      iconSlug: channel.type,
    });
  }

  for (const req of connectionRequirements(kit)) {
    const match = templates.find(
      (t) =>
        req.accepts.includes(t.id) ||
        (t.family && req.accepts.includes(t.family.id)),
    );
    badges.push({
      key: `conn:${req.accepts.join("|")}`,
      label: describeAccepts(req.accepts, templateById),
      ...(match?.iconSlug ? { iconSlug: match.iconSlug } : {}),
    });
  }

  if (kit.knowledgeBase) badges.push({ key: "kb", label: "Knowledge base" });

  const skills = kit.skillsInKit.length + kit.skills.length;
  if (skills > 0) {
    badges.push({
      key: "skills",
      label: `${skills} ${skills === 1 ? "Skill" : "Skills"}`,
    });
  }
  return badges;
}

export function matchesSearch(kit: StarterKitView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    kit.name.toLowerCase().includes(q) ||
    kit.description.toLowerCase().includes(q) ||
    kit.id.toLowerCase().includes(q)
  );
}

export function categoriesPresent(
  kits: readonly StarterKitView[],
): StarterKitView["category"][] {
  const order: StarterKitView["category"][] = [
    "software",
    "knowledge",
    "productivity",
    "research",
  ];
  return order.filter((c) => kits.some((k) => k.category === c));
}
