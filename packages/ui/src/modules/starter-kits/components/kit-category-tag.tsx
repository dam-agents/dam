import type { StarterKitView } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import { CATEGORY_LABEL } from "../lib/catalog-cards.js";
import { CATEGORY_BADGE_VARIANT, CATEGORY_ICON } from "../lib/kit-category.js";

export function KitCategoryTag({
  category,
}: {
  category: StarterKitView["category"];
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <Badge variant={CATEGORY_BADGE_VARIANT[category]} className="shrink-0">
      <span className="flex items-center gap-1">
        <Icon size={12} aria-hidden />
        {CATEGORY_LABEL[category]}
      </span>
    </Badge>
  );
}
