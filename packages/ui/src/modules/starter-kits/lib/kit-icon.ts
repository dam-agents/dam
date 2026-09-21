import {
  Book,
  type CarbonIconType,
  Catalog,
  ChartRelationship,
  Chat,
  Code,
  Document,
  Events,
  Idea,
  Link,
  Microscope,
  Search,
} from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

const BY_NAME: Record<string, CarbonIconType> = {
  book: Book,
  catalog: Catalog,
  chart: ChartRelationship,
  chat: Chat,
  code: Code,
  document: Document,
  events: Events,
  idea: Idea,
  link: Link,
  microscope: Microscope,
  search: Search,
};

const BY_CATEGORY: Record<StarterKitView["category"], CarbonIconType> = {
  knowledge: Book,
  software: Code,
  productivity: Chat,
  research: Microscope,
};

export function kitIcon(
  kit: Pick<StarterKitView, "icon" | "category">,
): CarbonIconType {
  const named = kit.icon ? BY_NAME[kit.icon.toLowerCase()] : undefined;
  return named ?? BY_CATEGORY[kit.category];
}

export const KIT_ICON_NAMES = Object.keys(BY_NAME);
