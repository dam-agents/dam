import type { SpendCategory } from "api-server-api";

import { SESSION_CATEGORY_LABELS } from "../../sessions/lib/session-category.js";

export const SESSION_TYPE_LABELS: Record<SpendCategory, string> = {
  ...SESSION_CATEGORY_LABELS,
  unknown: "Unattributed",
};
