import {
  Book,
  type CarbonIconType,
  Chemistry,
  Code,
  Lightning,
} from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

type Category = StarterKitView["category"];

export const CATEGORY_ICON: Record<Category, CarbonIconType> = {
  software: Code,
  productivity: Lightning,
  knowledge: Book,
  research: Chemistry,
};

export const CATEGORY_BADGE_VARIANT: Record<
  Category,
  "accent" | "kit" | "warning" | "success"
> = {
  software: "accent",
  productivity: "kit",
  knowledge: "warning",
  research: "success",
};
