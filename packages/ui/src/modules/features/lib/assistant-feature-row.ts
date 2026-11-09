import type { Brand, FeatureId } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Experimental features row that offers the
 * assistant. Both names it shows come from the brand — the install's assistant
 * and the platform it drives — so an install that renames either reads its own
 * words, never a word written here.
 */
export function assistantFeatureRow(brand: Brand): {
  id: FeatureId;
  label: string;
  description: string;
} {
  return {
    id: "dambledore",
    label: brand.assistantName,
    description: `Smart assistant that can control ${brand.name} for you`,
  };
}
