import { getBrand } from "../../../brand.js";

// UNIT_BOUNDARY_DESCRIPTION: the question an Agent's Update asks its owner, in the owner's terms: what the update is for, that it restarts the Agent and interrupts work, and the question itself. The platform picks the image, so no reference and no version appears here, and the product's name comes from the brand so an install reads its own.
export function updateDialogMessage(): string {
  return `This agent needs to update to support the latest ${getBrand().name} features. Updating restarts the agent, interrupting ongoing work. Update now?`;
}
